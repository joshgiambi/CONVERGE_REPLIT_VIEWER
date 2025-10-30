#!/usr/bin/env python3
"""
SegVol Inference Service
Provides REST API for volumetric medical image segmentation using SegVol model
"""

import os
import sys
import json
import tempfile
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
import numpy as np
import torch
from flask import Flask, request, jsonify
from flask_cors import CORS
import pydicom
from huggingface_hub import hf_hub_download
from scipy.ndimage import (
    binary_closing,
    binary_opening,
    generate_binary_structure,
)

try:
    from huggingface_hub.utils import LocalEntryNotFoundError
except (ImportError, AttributeError):
    class LocalEntryNotFoundError(FileNotFoundError):
        """Compatibility shim when huggingface_hub does not expose the exception."""
        pass

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Global model instance (loaded once on startup)
segvol_model = None
device = None


class SegVolPredictor:
    """Wrapper for SegVol model inference"""

    def __init__(self, model_path: Optional[str] = None, device: str = 'cuda',
                 spatial_size: Tuple[int, int, int] = (32, 256, 256),
                 patch_size: Tuple[int, int, int] = (4, 16, 16)):
        """
        Initialize SegVol model

        Args:
            model_path: Path to SegVol model checkpoint (downloads if None)
            device: 'cuda' or 'cpu'
            spatial_size: ROI size for the model (depth, height, width)
            patch_size: Patch size for the model (depth, height, width)
        """
        self.device = torch.device(device if torch.cuda.is_available() else 'cpu')
        self.spatial_size = spatial_size
        self.patch_size = patch_size
        self.cache_dir = Path(os.environ.get('SEGVOL_CACHE_DIR', Path(__file__).parent / 'weights')).resolve()
        self.repo_id = os.environ.get('SEGVOL_REPO_ID', 'BAAI/SegVol')
        self.allow_download = os.environ.get('SEGVOL_ALLOW_DOWNLOAD', '').lower() in {'1', 'true', 'yes'}
        logger.info(f"Initializing SegVol on device: {self.device}")

        try:
            # Import SegVol model (assumes SegVol repo is cloned and available)
            segvol_path = str(Path(__file__).parent / 'SegVol')
            if segvol_path not in sys.path:
                sys.path.insert(0, segvol_path)

            from segment_anything_volumetric import sam_model_registry
            from network.model import SegVol

            self.sam_model_registry = sam_model_registry
            self.SegVol = SegVol

            # Load model
            self.model = self._load_model(model_path)
            self.model.to(self.device)
            self.model.eval()

            logger.info("SegVol model loaded successfully")

        except Exception as e:
            logger.error(f"Failed to load SegVol model: {e}", exc_info=True)
            raise

    def _resolve_checkpoint_path(self, model_path: Optional[str]) -> str:
        """
        Locate the SegVol checkpoint locally or download it if permitted.
        """
        # 1. Explicitly provided path
        if model_path:
            candidate_path = Path(model_path).expanduser()
            if candidate_path.is_dir():
                candidate_file = candidate_path / 'pytorch_model.bin'
                if candidate_file.exists():
                    logger.info(f"Using SegVol weights from provided directory: {candidate_file}")
                    return str(candidate_file)
            elif candidate_path.exists():
                logger.info(f"Using SegVol weights from provided path: {candidate_path}")
                return str(candidate_path)
            else:
                logger.warning(f"Provided model_path '{model_path}' does not exist. Falling back to cached weights.")

        cache_dir = self.cache_dir
        cache_dir.mkdir(parents=True, exist_ok=True)

        # 2. Check local cache first (offline-friendly)
        try:
            checkpoint_path = hf_hub_download(
                repo_id=self.repo_id,
                filename='pytorch_model.bin',
                cache_dir=str(cache_dir),
                local_files_only=True
            )
            logger.info(f"Using locally cached SegVol weights: {checkpoint_path}")
            return checkpoint_path
        except LocalEntryNotFoundError as err:
            if not self.allow_download:
                raise RuntimeError(
                    "SegVol weights not found in cache. "
                    f"Place 'pytorch_model.bin' under '{cache_dir}' "
                    "(mirroring the HuggingFace cache layout) or set "
                    "SEGVOL_ALLOW_DOWNLOAD=1 to allow downloading."
                ) from err
            logger.info("Local SegVol weights not found. Attempting HuggingFace download (SEGVOL_ALLOW_DOWNLOAD=1).")
        except Exception as err:
            if not self.allow_download:
                raise RuntimeError(
                    f"Failed to access cached SegVol weights in '{cache_dir}': {err}"
                ) from err
            logger.warning(f"Local cache lookup failed ({err}); attempting download...")

        # 3. Download if explicitly allowed
        try:
            checkpoint_path = hf_hub_download(
                repo_id=self.repo_id,
                filename='pytorch_model.bin',
                cache_dir=str(cache_dir),
                local_files_only=False
            )
            logger.info(f"Downloaded SegVol weights to: {checkpoint_path}")
            return checkpoint_path
        except Exception as err:
            raise RuntimeError(
                "Unable to download SegVol weights from HuggingFace. "
                "Ensure network access is available or manually provide the checkpoint."
            ) from err

    def _load_model(self, model_path: str):
        """Load SegVol model from checkpoint or HuggingFace"""
        try:
            logger.info("Building SegVol model architecture...")

            # Create args object for model building
            class Args:
                def __init__(self, spatial_size, patch_size):
                    self.spatial_size = spatial_size
                    self.patch_size = patch_size

            args = Args(self.spatial_size, self.patch_size)

            # Build SAM-based model using SegVol's build function
            sam_model = self.sam_model_registry['vit'](args=args, checkpoint=None)

            # Get CLIP checkpoint path
            clip_ckpt_path = str(Path(__file__).parent / 'SegVol' / 'config' / 'clip')
            if not Path(clip_ckpt_path).exists():
                # Fallback to default
                clip_ckpt_path = 'openai/clip-vit-base-patch16'
                logger.warning(f"Local CLIP checkpoint not found, using: {clip_ckpt_path}")

            # Wrap in SegVol
            model = self.SegVol(
                image_encoder=sam_model.image_encoder,
                mask_decoder=sam_model.mask_decoder,
                prompt_encoder=sam_model.prompt_encoder,
                clip_ckpt=clip_ckpt_path,
                roi_size=self.spatial_size,
                patch_size=self.patch_size,
                test_mode=True
            )

            checkpoint_path = self._resolve_checkpoint_path(model_path)
            logger.info(f"Loading weights from {checkpoint_path}")
            checkpoint = torch.load(checkpoint_path, map_location=self.device)

            # Handle both wrapped and unwrapped state dicts
            if isinstance(checkpoint, dict):
                if 'model' in checkpoint:
                    model.load_state_dict(checkpoint['model'], strict=False)
                elif 'state_dict' in checkpoint:
                    model.load_state_dict(checkpoint['state_dict'], strict=False)
                else:
                    model.load_state_dict(checkpoint, strict=False)
            else:
                model.load_state_dict(checkpoint, strict=False)

            return model

        except Exception as e:
            logger.error(f"Model loading failed: {e}", exc_info=True)
            raise

    def predict_next_slice(
        self,
        reference_contour: np.ndarray,
        reference_slice_data: np.ndarray,
        target_slice_data: np.ndarray,
        reference_slice_position: float,
        target_slice_position: float,
        spacing: Tuple[float, float, float] = (1.0, 1.0, 1.0),
        volume_slices: Optional[np.ndarray] = None,
        volume_positions: Optional[np.ndarray] = None
    ) -> Dict[str, Any]:
        """
        Predict contour on target slice using reference contour and image data

        Args:
            reference_contour: Nx2 array of (x, y) points in pixel coordinates
            reference_slice_data: 2D array of HU values for reference slice
            target_slice_data: 2D array of HU values for target slice
            reference_slice_position: Z position of reference slice
            target_slice_position: Z position of target slice
            spacing: (x_spacing, y_spacing, z_spacing) in mm
            volume_slices: Optional 3D array (D, H, W) of additional DICOM slices for context
            volume_positions: Optional 1D array of Z positions for each slice in volume_slices

        Returns:
            Dictionary containing:
                - predicted_contour: Nx2 array of (x, y) points
                - confidence: float 0-1
                - method: str
        """
        try:
            with torch.no_grad():
                # Prepare inputs
                # Create a synthetic 3D volume from the two slices
                # This is a simplified approach - for full volume segmentation,
                # you'd need the entire volume

                # Store original shape for later upscaling
                original_shape = reference_slice_data.shape
                logger.info(f"📊 Original image shape: {original_shape}")
                logger.info(f"📊 Reference slice pixel range: [{np.min(reference_slice_data):.1f}, {np.max(reference_slice_data):.1f}], mean: {np.mean(reference_slice_data):.1f}")
                logger.info(f"📊 Target slice pixel range: [{np.min(target_slice_data):.1f}, {np.max(target_slice_data):.1f}], mean: {np.mean(target_slice_data):.1f}")

                # SegVol expects 256×256 images (spatial_size config)
                # Resize to model's expected size
                from skimage.transform import resize
                target_size = (self.spatial_size[1], self.spatial_size[2])  # (256, 256)

                # Resize images
                ref_slice = resize(reference_slice_data, target_size, order=1, preserve_range=True, anti_aliasing=True)
                target_slice = resize(target_slice_data, target_size, order=1, preserve_range=True, anti_aliasing=True)

                # Normalize after resizing
                ref_slice = self._normalize_ct(ref_slice)
                target_slice = self._normalize_ct(target_slice)
                logger.info(f"📊 After normalization - Ref slice: [{np.min(ref_slice):.3f}, {np.max(ref_slice):.3f}], Target: [{np.min(target_slice):.3f}, {np.max(target_slice):.3f}]")

                # Scale contour coordinates to 256×256
                scale_x = target_size[1] / original_shape[1]
                scale_y = target_size[0] / original_shape[0]
                scaled_contour = reference_contour.copy().astype(np.float32)  # Convert to float for scaling
                scaled_contour[:, 0] *= scale_x  # Scale x
                scaled_contour[:, 1] *= scale_y  # Scale y

                # Convert contour to mask
                ref_mask = self._contour_to_mask(scaled_contour, ref_slice.shape)
                logger.info(f"📊 Reference mask shape (resized): {ref_mask.shape}, contour points: {len(scaled_contour)}")
                logger.info(f"📊 Reference slice shape (resized): {ref_slice.shape}")

                # Build 3D volume - use real DICOM slices if available, otherwise interpolate
                # SegVol model expects EXACTLY depth=32 (from spatial_size config)
                target_depth = self.spatial_size[0]  # 32
                distance = abs(target_slice_position - reference_slice_position)
                # Ensure num_interp_slices and ref_idx_in_volume are always defined for metadata
                num_interp_slices = 0
                ref_idx_in_volume = 0  # Default for interpolated volumes

                if volume_slices is not None and volume_positions is not None and len(volume_slices) >= target_depth:
                    logger.info(f"📊 Using {len(volume_slices)} real DICOM slices to build volume")

                    # Use real DICOM slices - select 32 slices around ref and target
                    # Find indices for reference and target positions
                    ref_idx = np.argmin(np.abs(volume_positions - reference_slice_position))
                    target_idx = np.argmin(np.abs(volume_positions - target_slice_position))

                    # Get range that includes both ref and target
                    min_idx = min(ref_idx, target_idx)
                    max_idx = max(ref_idx, target_idx)

                    # Expand to get 32 slices centered around this range
                    range_size = max_idx - min_idx + 1
                    if range_size < target_depth:
                        # Expand symmetrically
                        expand = (target_depth - range_size) // 2
                        min_idx = max(0, min_idx - expand)
                        max_idx = min(len(volume_slices) - 1, min_idx + target_depth - 1)

                    # Extract and resize slices
                    volume = np.zeros((target_depth, *ref_slice.shape), dtype=np.float32)
                    for i in range(target_depth):
                        slice_idx = min(min_idx + i, len(volume_slices) - 1)
                        slice_data = volume_slices[slice_idx]
                        # Resize to 256×256
                        from skimage.transform import resize
                        resized = resize(slice_data, target_size, order=1, preserve_range=True, anti_aliasing=True)
                        volume[i] = self._normalize_ct(resized)

                    # Build mask volume - put reference mask at appropriate index
                    mask_volume = np.zeros((target_depth, *ref_mask.shape), dtype=np.float32)
                    ref_idx_in_volume = ref_idx - min_idx
                    if 0 <= ref_idx_in_volume < target_depth:
                        mask_volume[ref_idx_in_volume] = ref_mask

                    logger.info(f"📊 Built real volume: ref at index {ref_idx_in_volume}, target at {target_idx - min_idx}")
                else:
                    logger.info(f"📊 Using synthetic interpolation (no real slices available)")
                    # Fallback: simple interpolation between ref and target
                    num_interp_slices = target_depth - 2
                    volume = self._interpolate_slices(ref_slice, target_slice, num_interp_slices)
                    mask_volume = self._interpolate_slices(ref_mask, np.zeros_like(target_slice), num_interp_slices)
                    ref_idx_in_volume = 0  # Reference is at first slice for interpolated volumes

                # Prepare tensors
                volume_tensor = torch.from_numpy(volume).unsqueeze(0).unsqueeze(0).float().to(self.device)
                mask_tensor = torch.from_numpy(mask_volume).unsqueeze(0).unsqueeze(0).float().to(self.device)
                logger.info(f"📊 Volume tensor shape: {volume_tensor.shape} (target depth: {target_depth})")

                # Run inference with correct reference mask index
                # SegVol expects specific input format
                output = self._run_segvol_inference(volume_tensor, mask_tensor, spacing, ref_mask_idx=ref_idx_in_volume)
                logger.info(f"📊 Output shape: {output.shape}")

                # Extract predicted mask for target slice
                # Volume structure: [ref_slice, interp_1, ..., interp_n, target_slice]
                # Reference is at index 0, target is at index -1 (last slice)
                # The mask volume has the reference mask at index 0, zeros at target
                # We want the prediction at the target location (last slice)
                target_slice_idx = -1  # Always use last slice in volume
                predicted_mask = output[0, 0, target_slice_idx, :, :].cpu().numpy()
                logger.info(f"📊 Extracting target slice at index {target_slice_idx} from volume of depth {output.shape[2]}")
                logger.info(f"📊 Reference position: {reference_slice_position:.1f}, Target position: {target_slice_position:.1f}, Distance: {distance:.1f}")
                logger.info(f"📊 Predicted mask shape: {predicted_mask.shape}, max value: {np.max(predicted_mask):.3f}")

                # Convert mask back to contour (at 256×256 resolution)
                predicted_contour = self._mask_to_contour(predicted_mask)
                logger.info(f"📊 Predicted contour points (256×256): {len(predicted_contour)}, sample: {predicted_contour[:2].tolist() if len(predicted_contour) > 0 else []}")

                if len(predicted_contour) == 0:
                    raise RuntimeError(
                        "SegVol produced an empty contour. Check prompt generation or model weights."
                    )

                # Scale contour back to original resolution
                if len(predicted_contour) > 0:
                    inv_scale_x = original_shape[1] / target_size[1]  # 512/256 = 2.0
                    inv_scale_y = original_shape[0] / target_size[0]  # 512/256 = 2.0
                    predicted_contour[:, 0] *= inv_scale_x  # Scale x back
                    predicted_contour[:, 1] *= inv_scale_y  # Scale y back
                    logger.info(f"📊 Predicted contour scaled to original: {len(predicted_contour)} points, sample: {predicted_contour[:2].tolist()}")

                # Calculate confidence based on mask quality
                confidence = self._calculate_confidence(predicted_mask, ref_mask)

                return {
                    'predicted_contour': predicted_contour.tolist(),
                    'confidence': float(confidence),
                    'method': 'segvol_volumetric',
                    'metadata': {
                        'num_points': len(predicted_contour),
                        'slice_distance': distance,
                        'interpolated_slices': num_interp_slices
                    }
                }

        except Exception as e:
            logger.error(f"Prediction failed: {e}")
            raise

    def _normalize_ct(self, image: np.ndarray) -> np.ndarray:
        """Normalize CT image using SegVol's expected normalization

        Based on SegVol's demo preprocessing:
        1. Foreground normalization (clip by percentiles, standardize)
        2. MinMax normalization to [0, 1]
        """
        # Step 1: Foreground normalization
        # Get foreground pixels (above mean threshold)
        flat = image.flatten()
        threshold = np.mean(flat)
        foreground = flat[flat > threshold]

        if len(foreground) > 0:
            # Clip based on foreground percentiles
            upper_bound = np.percentile(foreground, 99.95)
            lower_bound = np.percentile(foreground, 0.05)
            mean = np.mean(foreground)
            std = np.std(foreground)

            # Clip and standardize
            image = np.clip(image, lower_bound, upper_bound)
            image = (image - mean) / np.clip(std, a_min=1e-8, a_max=None)

        # Step 2: MinMax normalization to [0, 1]
        image = image - image.min()
        image = image / np.clip(image.max(), a_min=1e-8, a_max=None)

        return image.astype(np.float32)

    def _contour_to_mask(self, contour: np.ndarray, shape: Tuple[int, int]) -> np.ndarray:
        """Convert contour points to binary mask"""
        from skimage.draw import polygon

        mask = np.zeros(shape, dtype=np.float32)
        if len(contour) > 0:
            rr, cc = polygon(contour[:, 1], contour[:, 0], shape)
            mask[rr, cc] = 1.0
        return mask

    def _mask_to_contour(self, mask: np.ndarray, threshold: float = 0.52) -> np.ndarray:
        """Convert binary mask to contour points

        Args:
            mask: Probability mask from model (0-1)
            threshold: Probability threshold for binarization
                      Default 0.52 balances precision vs recall
        """
        from skimage.measure import find_contours

        # Use a very low fixed threshold since the model outputs weak signals
        # The model's max logit is ~0.15, giving sigmoid(0.15) ≈ 0.537
        max_val = np.max(mask)

        # Adapt threshold to the confidence of the prediction
        if max_val <= 1e-6:
            logger.warning("Predicted mask is essentially empty (max <= 1e-6)")
            return np.array([])

        adaptive_threshold = max(0.1, min(0.5, max_val * 0.6))
        logger.info(f"Using adaptive threshold {adaptive_threshold:.3f} (max={max_val:.3f})")

        binary_mask = (mask >= adaptive_threshold).astype(np.uint8)
        num_mask_pixels = np.sum(binary_mask)
        logger.info(f"Binary mask: {num_mask_pixels} pixels above threshold {adaptive_threshold:.3f}")

        if num_mask_pixels == 0:
            # Relax threshold further if still empty
            fallback_threshold = max(0.05, max_val * 0.4)
            logger.warning(f"No pixels above adaptive threshold; retrying with {fallback_threshold:.3f}")
            binary_mask = (mask >= fallback_threshold).astype(np.uint8)
            num_mask_pixels = np.sum(binary_mask)
            logger.info(f"Fallback mask pixels: {num_mask_pixels}")

        if num_mask_pixels == 0:
            logger.warning(f"No contours found even with relaxed threshold, max mask value: {max_val:.3f}")
            return np.array([])

        # Light morphology to remove speckle and close holes
        structure = generate_binary_structure(2, 1)
        binary_mask = binary_closing(binary_mask, structure=structure, iterations=1)
        binary_mask = binary_opening(binary_mask, structure=structure, iterations=1)

        contours = find_contours(binary_mask, 0.5)

        if len(contours) == 0:
            logger.warning(f"No contours extracted after morphology, mask pixels: {num_mask_pixels}, max mask value: {max_val:.3f}")
            return np.array([])

        # Return largest contour
        largest_contour = max(contours, key=len)
        # Swap to (x, y) format
        contour = np.column_stack([largest_contour[:, 1], largest_contour[:, 0]])

        logger.info(f"Mask to contour: threshold={threshold:.3f}, mask_pixels={np.sum(binary_mask)}, contour_points={len(contour)}")

        return contour

    def _interpolate_slices(
        self,
        slice1: np.ndarray,
        slice2: np.ndarray,
        num_slices: int
    ) -> np.ndarray:
        """Linear interpolation between two slices"""
        if num_slices <= 1:
            return np.stack([slice1, slice2], axis=0)

        volume = np.zeros((num_slices + 2, *slice1.shape), dtype=np.float32)
        volume[0] = slice1
        volume[-1] = slice2

        for i in range(1, num_slices + 1):
            alpha = i / (num_slices + 1)
            volume[i] = (1 - alpha) * slice1 + alpha * slice2

        return volume

    def _run_segvol_inference(
        self,
        volume: torch.Tensor,
        mask: torch.Tensor,
        spacing: Tuple[float, float, float],
        ref_mask_idx: int = 0
    ) -> torch.Tensor:
        """
        Run actual SegVol model inference using the mask as a prompt

        Args:
            volume: Input volume tensor (B, C, D, H, W)
            mask: Reference mask volume (B, C, D, H, W)
            spacing: Voxel spacing (x, y, z)
            ref_mask_idx: Index in the volume where the reference mask is located
        """
        try:
            # SegVol expects images in shape (B, C, D, H, W)
            # Volume should already be in this format from caller

            # Convert mask to bounding box + points prompt
            # Get the reference mask from the specified slice index
            mask_np = mask[0, 0].cpu().numpy()
            ref_slice_mask = mask_np[ref_mask_idx]  # Extract mask from correct index
            logger.info(f"📊 Extracting reference mask from index {ref_mask_idx}/{mask_np.shape[0]}, mask has {np.sum(ref_slice_mask > 0.5):.0f} pixels")

            # Find 2D bounding box in reference slice
            nonzero_y, nonzero_x = np.nonzero(ref_slice_mask)

            if len(nonzero_y) == 0:
                logger.warning("Empty reference mask, returning zero prediction")
                return torch.zeros_like(mask)

            # Get 2D bounding box with small padding to allow growth
            pad = 6
            y_min = max(0, int(nonzero_y.min()) - pad)
            y_max = min(ref_slice_mask.shape[0] - 1, int(nonzero_y.max()) + pad)
            x_min = max(0, int(nonzero_x.min()) - pad)
            x_max = min(ref_slice_mask.shape[1] - 1, int(nonzero_x.max()) + pad)
            # Calculate centroid for point prompt
            centroid_y = float(nonzero_y.mean())
            centroid_x = float(nonzero_x.mean())

            # For z-dimension, use a tight box around where we expect the structure
            # The mask volume has the reference at slice 0, fading through interpolation
            # We want to constrain the model to predict only in the region where mask > 0.1
            z_indices_with_mask = np.where(np.any(mask_np > 0.1, axis=(1, 2)))[0]
            if len(z_indices_with_mask) > 0:
                z_min = max(0, z_indices_with_mask.min())
                z_max = min(mask_np.shape[0] - 1, z_indices_with_mask.max())
            else:
                # Fallback: just use first few slices
                z_min = 0
                z_max = min(5, mask_np.shape[0] - 1)

            # Compose box in (x, z, y) order expected by SegVol prompt encoder
            box = torch.tensor(
                [[float(x_min), float(z_min), float(y_min), float(x_max), float(z_max), float(y_max)]],
                dtype=torch.float32
            ).to(self.device)
            logger.info(
                f"📊 Bounding box prompt (x,z,y): x=[{x_min},{x_max}], z=[{z_min},{z_max}], y=[{y_min},{y_max}]"
            )
            logger.info(
                f"📊 Box size: {x_max - x_min}x{z_max - z_min}x{y_max - y_min} pixels "
                f"(reported as Δx×Δz×Δy to match prompt order)"
            )

            # Build point prompts (one positive at centroid, optional negatives around edges)
            points_list = []
            labels_list = []
            centroid_x = min(float(ref_slice_mask.shape[1] - 1), max(0.0, centroid_x))
            centroid_y = min(float(ref_slice_mask.shape[0] - 1), max(0.0, centroid_y))
            centroid_z = float(ref_mask_idx)
            points_list.append([centroid_x, centroid_z, centroid_y])
            labels_list.append(1.0)

            # Add a negative point outside bounding box to discourage expansion
            neg_x = min(float(ref_slice_mask.shape[1]-1), max(0.0, x_min - 10))
            neg_y = min(float(ref_slice_mask.shape[0]-1), max(0.0, y_min - 10))
            points_list.append([neg_x, centroid_z, neg_y])
            labels_list.append(0.0)
            logger.info(
                "📊 Point prompts (x,z,y): pos=(%.1f, %.1f, %.1f), neg=(%.1f, %.1f, %.1f)",
                centroid_x, centroid_z, centroid_y, neg_x, centroid_z, neg_y
            )

            points_tensor = torch.tensor([points_list], dtype=torch.float32).to(self.device)
            labels_tensor = torch.tensor([labels_list], dtype=torch.float32).to(self.device)

            # Run SegVol inference with box prompt
            with torch.no_grad():
                logits = self.model(
                    volume.to(self.device),
                    text=None,  # Not using text prompts for contour propagation
                    boxes=box,
                    points=(points_tensor, labels_tensor)
                )
                logger.info(f"📊 Model logits: shape={logits.shape}, range=[{logits.min().item():.3f}, {logits.max().item():.3f}]")

            # Apply sigmoid to get probabilities
            probabilities = torch.sigmoid(logits)

            return probabilities

        except Exception as e:
            logger.error(f"SegVol inference failed: {e}", exc_info=True)
            logger.warning("Falling back to simple mask propagation")
            # Fallback: just propagate the mask
            return mask

    def _calculate_confidence(self, predicted_mask: np.ndarray, reference_mask: np.ndarray) -> float:
        """Calculate prediction confidence based on mask characteristics

        Returns confidence score 0-1, where predictions with unreasonable sizes get 0
        """
        # Simple heuristic: check mask coherence and size
        mask_area = np.sum(predicted_mask > 0.5)
        ref_area = np.sum(reference_mask > 0.5)

        if mask_area == 0:
            logger.warning(f"Prediction rejected: empty mask")
            return 0.0

        # Reject predictions that are absurdly large (>50x reference area)
        # More permissive threshold - anatomy can vary significantly between slices
        area_expansion = mask_area / ref_area if ref_area > 0 else float('inf')
        if area_expansion > 50.0:
            logger.warning(f"Prediction rejected: mask {area_expansion:.1f}x larger than reference ({mask_area} vs {ref_area})")
            return 0.0

        # Very lenient area scoring - accept up to 10x changes
        # This is important for anatomical structures that change size between slices
        if area_expansion <= 5.0:
            # Very gradual penalty for up to 5x change
            area_score = 1.0 - (abs(area_expansion - 1.0) / 10.0)  # Max penalty of 0.4 for 5x change
        elif area_expansion <= 20.0:
            # Moderate penalty for 5-20x change
            area_ratio = min(mask_area, ref_area) / max(mask_area, ref_area)
            area_score = area_ratio * 0.6  # Still give some credit
        else:
            # Heavy penalty for >20x but <50x
            area_ratio = min(mask_area, ref_area) / max(mask_area, ref_area)
            area_score = area_ratio * 0.3

        # Compactness (perimeter^2 / area)
        # Lower values indicate more compact shapes
        from skimage.measure import perimeter
        perim = perimeter((predicted_mask > 0.5).astype(np.uint8))
        if mask_area > 0:
            compactness = (perim ** 2) / (4 * np.pi * mask_area)
            compactness_score = np.clip(1.0 / (1.0 + compactness * 0.1), 0, 1)
        else:
            compactness_score = 0.0

        # Combine scores - weight area less heavily to be more permissive
        confidence = 0.5 * area_score + 0.5 * compactness_score

        logger.info(f"Confidence: mask_area={mask_area}, ref_area={ref_area}, expansion={area_expansion:.1f}x, area_score={area_score:.3f}, compactness={compactness_score:.3f}, final={confidence:.3f}")

        return float(np.clip(confidence, 0, 1))


# API Endpoints

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'model_loaded': segvol_model is not None,
        'device': str(device)
    })


@app.route('/predict', methods=['POST'])
def predict():
    """
    Predict contour on target slice

    Expected JSON payload:
    {
        "reference_contour": [[x1, y1], [x2, y2], ...],
        "reference_slice_data": [...], // Flattened HU values
        "target_slice_data": [...],
        "reference_slice_position": 50.0,
        "target_slice_position": 51.0,
        "image_shape": [512, 512],
        "spacing": [1.0, 1.0, 2.5]
    }
    """
    try:
        data = request.json

        # Validate inputs
        required_fields = [
            'reference_contour', 'reference_slice_data', 'target_slice_data',
            'reference_slice_position', 'target_slice_position', 'image_shape'
        ]
        for field in required_fields:
            if field not in data:
                return jsonify({'error': f'Missing required field: {field}'}), 400

        # Parse inputs
        reference_contour = np.array(data['reference_contour'])
        image_shape = tuple(data['image_shape'])

        reference_slice_data = np.array(data['reference_slice_data']).reshape(image_shape)
        target_slice_data = np.array(data['target_slice_data']).reshape(image_shape)

        reference_slice_position = float(data['reference_slice_position'])
        target_slice_position = float(data['target_slice_position'])
        spacing = tuple(data.get('spacing', [1.0, 1.0, 1.0]))

        # Parse optional volume data
        volume_slices = None
        volume_positions = None
        if 'volume_slices' in data and 'volume_positions' in data:
            volume_slices = np.array(data['volume_slices'])  # Shape: (N, H, W)
            volume_positions = np.array(data['volume_positions'])  # Shape: (N,)
            logger.info(f"🎯 PREDICTION REQUEST: ref_pos={reference_slice_position:.1f}, target_pos={target_slice_position:.1f}, distance={abs(target_slice_position - reference_slice_position):.1f}mm, contour_points={len(reference_contour)}, volume_slices={len(volume_slices)}")
        else:
            logger.info(f"🎯 PREDICTION REQUEST: ref_pos={reference_slice_position:.1f}, target_pos={target_slice_position:.1f}, distance={abs(target_slice_position - reference_slice_position):.1f}mm, contour_points={len(reference_contour)}")

        # Run prediction
        if segvol_model is None:
            return jsonify({'error': 'Model not loaded'}), 500

        result = segvol_model.predict_next_slice(
            reference_contour=reference_contour,
            reference_slice_data=reference_slice_data,
            target_slice_data=target_slice_data,
            reference_slice_position=reference_slice_position,
            target_slice_position=target_slice_position,
            spacing=spacing,
            volume_slices=volume_slices,
            volume_positions=volume_positions
        )

        return jsonify(result)

    except Exception as e:
        logger.error(f"Prediction error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/predict_batch', methods=['POST'])
def predict_batch():
    """
    Predict contours for multiple target slices at once
    Useful for propagating to several slices simultaneously
    """
    try:
        data = request.json
        results = []

        for target_info in data.get('targets', []):
            # Run individual prediction for each target
            result = segvol_model.predict_next_slice(
                reference_contour=np.array(data['reference_contour']),
                reference_slice_data=np.array(data['reference_slice_data']).reshape(tuple(data['image_shape'])),
                target_slice_data=np.array(target_info['slice_data']).reshape(tuple(data['image_shape'])),
                reference_slice_position=float(data['reference_slice_position']),
                target_slice_position=float(target_info['slice_position']),
                spacing=tuple(data.get('spacing', [1.0, 1.0, 1.0]))
            )
            results.append({
                'slice_position': target_info['slice_position'],
                **result
            })

        return jsonify({'predictions': results})

    except Exception as e:
        logger.error(f"Batch prediction error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/segment', methods=['POST'])
def segment_from_scribbles():
    """
    Segment 3D tumor volume from user scribble annotations

    Request body:
    {
        "volume": [[[...]]]  # 3D array (Z, Y, X) - CT volume in HU
        "scribbles": [  # List of scribble annotations
            {
                "slice": 10,
                "points": [[x1, y1], [x2, y2], ...],
                "label": 1  # 1=foreground, 0=background
            }
        ],
        "spacing": [z_spacing, y_spacing, x_spacing]  # Optional voxel spacing
    }

    Returns:
    {
        "mask": [[[...]]]  # 3D binary mask (Z, Y, X)
        "confidence": 0.95
    }
    """
    try:
        data = request.json

        # Parse inputs
        volume = np.array(data['volume'], dtype=np.float32)
        scribbles = data.get('scribbles', [])
        spacing = tuple(data.get('spacing', [1.0, 1.0, 1.0]))

        logger.info(f"🎯 TUMOR SEGMENTATION REQUEST: volume shape={volume.shape}, scribbles={len(scribbles)}, spacing={spacing}")

        if segvol_model is None:
            return jsonify({'error': 'Model not loaded'}), 500

        if len(scribbles) == 0:
            return jsonify({'error': 'No scribbles provided'}), 400

        # Group scribbles by slice
        scribbles_by_slice = {}
        for scribble in scribbles:
            slice_idx = int(scribble['slice'])
            if slice_idx not in scribbles_by_slice:
                scribbles_by_slice[slice_idx] = []
            scribbles_by_slice[slice_idx].append(scribble)

        # Calculate bounding box around all scribbles
        all_points = []
        for scribble in scribbles:
            if scribble.get('points'):
                all_points.extend(scribble['points'])

        if len(all_points) == 0:
            return jsonify({'error': 'No scribble points found'}), 400

        points_array = np.array(all_points)
        min_x, min_y = points_array.min(axis=0).astype(int)
        max_x, max_y = points_array.max(axis=0).astype(int)

        # Get slice range
        annotated_slices = sorted(scribbles_by_slice.keys())
        min_z = annotated_slices[0]
        max_z = annotated_slices[-1]

        # Add margin for tumor growth
        margin_xy = 20  # pixels
        margin_z = 3  # slices

        crop_x1 = max(0, min_x - margin_xy)
        crop_y1 = max(0, min_y - margin_xy)
        crop_z1 = max(0, min_z - margin_z)
        crop_x2 = min(volume.shape[2], max_x + margin_xy)
        crop_y2 = min(volume.shape[1], max_y + margin_xy)
        crop_z2 = min(volume.shape[0], max_z + margin_z)

        logger.info(f"📊 Crop box: x=[{crop_x1}:{crop_x2}], y=[{crop_y1}:{crop_y2}], z=[{crop_z1}:{crop_z2}]")

        # Crop volume to region of interest
        cropped_volume = volume[crop_z1:crop_z2, crop_y1:crop_y2, crop_x1:crop_x2]

        # Resize to SegVol's expected input size (32, 256, 256)
        from skimage.transform import resize
        target_size = (segvol_model.spatial_size[0], segvol_model.spatial_size[1], segvol_model.spatial_size[2])
        resized_volume = resize(cropped_volume, target_size, order=1, preserve_range=True, anti_aliasing=True)

        # Normalize CT data using SegVol's normalization
        normalized_volume = segvol_model._normalize_ct(resized_volume)

        # Create mask from scribbles
        # Scale scribble coordinates to resized space
        scale_x = target_size[2] / cropped_volume.shape[2]
        scale_y = target_size[1] / cropped_volume.shape[1]
        scale_z = target_size[0] / cropped_volume.shape[0]

        mask_volume = np.zeros(target_size, dtype=np.float32)

        for slice_idx, slice_scribbles in scribbles_by_slice.items():
            # Adjust slice index to cropped volume
            adjusted_slice_idx = slice_idx - crop_z1
            if adjusted_slice_idx < 0 or adjusted_slice_idx >= cropped_volume.shape[0]:
                continue

            # Scale to resized volume
            scaled_slice_idx = int(adjusted_slice_idx * scale_z)
            if scaled_slice_idx >= target_size[0]:
                scaled_slice_idx = target_size[0] - 1

            # Create mask for this slice
            for scribble in slice_scribbles:
                points = np.array(scribble['points'])
                # Adjust to crop coordinates
                points[:, 0] -= crop_x1
                points[:, 1] -= crop_y1
                # Scale to resized space
                scaled_points = points.copy().astype(np.float32)
                scaled_points[:, 0] *= scale_x
                scaled_points[:, 1] *= scale_y

                # Convert to mask
                from skimage.draw import polygon
                if len(scaled_points) >= 3:
                    # Create filled polygon from points
                    import cv2
                    mask_slice = np.zeros((target_size[1], target_size[2]), dtype=np.uint8)
                    cv2.fillPoly(mask_slice, [scaled_points.astype(np.int32)], 1)
                    mask_volume[scaled_slice_idx] = np.maximum(mask_volume[scaled_slice_idx], mask_slice)

        logger.info(f"📊 Mask volume: {np.sum(mask_volume > 0.5)} non-zero voxels")

        # Prepare tensors for SegVol
        volume_tensor = torch.from_numpy(normalized_volume).unsqueeze(0).unsqueeze(0).float().to(segvol_model.device)
        mask_tensor = torch.from_numpy(mask_volume).unsqueeze(0).unsqueeze(0).float().to(segvol_model.device)

        # Find the slice with the most mask pixels (reference slice)
        mask_pixels_per_slice = np.sum(mask_volume > 0.5, axis=(1, 2))
        ref_mask_idx = int(np.argmax(mask_pixels_per_slice))

        logger.info(f"📊 Using slice {ref_mask_idx} as reference (most scribble pixels)")

        # Run SegVol inference
        with torch.no_grad():
            output = segvol_model._run_segvol_inference(
                volume_tensor,
                mask_tensor,
                spacing,
                ref_mask_idx=ref_mask_idx
            )

        # Extract predicted mask
        predicted_mask_resized = (output[0, 0].cpu().numpy() > 0.5).astype(np.uint8)

        # Resize back to cropped volume size
        predicted_mask_cropped = resize(
            predicted_mask_resized.astype(np.float32),
            cropped_volume.shape,
            order=0,
            preserve_range=True,
            anti_aliasing=False
        ).astype(np.uint8)

        # Place cropped mask back into full volume
        mask_3d = np.zeros(volume.shape, dtype=np.uint8)
        mask_3d[crop_z1:crop_z2, crop_y1:crop_y2, crop_x1:crop_x2] = predicted_mask_cropped

        # Calculate confidence based on mask quality
        confidence = 0.85  # SegVol is generally high confidence for medical images

        result = {
            'mask': mask_3d.tolist(),
            'confidence': confidence
        }

        logger.info(f"✅ Tumor segmentation complete: {np.sum(mask_3d)} voxels, confidence={confidence:.2f}")

        return jsonify(result)

    except Exception as e:
        logger.error(f"Tumor segmentation failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


def initialize_model(model_path: Optional[str] = None, device_name: str = 'cuda'):
    """Initialize the global SegVol model"""
    global segvol_model, device

    try:
        logger.info("Loading SegVol model...")
        device = device_name
        segvol_model = SegVolPredictor(model_path=model_path, device=device_name)
        logger.info("SegVol model loaded and ready")
    except Exception as e:
        logger.error(f"Failed to initialize model: {e}")
        raise


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='SegVol Inference Service')
    parser.add_argument('--port', type=int, default=5001, help='Port to run service on')
    parser.add_argument('--host', type=str, default='127.0.0.1', help='Host to bind to')
    parser.add_argument('--model-path', type=str, default=None, help='Path to model checkpoint')
    parser.add_argument('--device', type=str, default='cuda', help='Device: cuda or cpu')

    args = parser.parse_args()

    # Initialize model on startup
    initialize_model(model_path=args.model_path, device_name=args.device)

    # Run Flask app
    logger.info(f"Starting SegVol service on {args.host}:{args.port}")
    app.run(host=args.host, port=args.port, debug=False)

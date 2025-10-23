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

    def __init__(self, model_path: Optional[str] = None, device: str = 'cuda'):
        """
        Initialize SegVol model

        Args:
            model_path: Path to SegVol model checkpoint (downloads if None)
            device: 'cuda' or 'cpu'
        """
        self.device = torch.device(device if torch.cuda.is_available() else 'cpu')
        logger.info(f"Initializing SegVol on device: {self.device}")

        try:
            # Import SegVol model (assumes SegVol repo is cloned and available)
            # You'll need to clone: git clone https://github.com/BAAI-DCAI/SegVol.git
            sys.path.insert(0, str(Path(__file__).parent / 'SegVol'))

            from model.segment_anything import sam_model_registry
            from model.zoom_out_zoom_in import ZoomOutZoomIn

            # Load model (this is a simplified version - adjust based on actual SegVol API)
            if model_path is None:
                # Default to huggingface model
                model_path = "BAAI/SegVol"

            self.model = self._load_model(model_path)
            self.model.to(self.device)
            self.model.eval()

            logger.info("SegVol model loaded successfully")

        except Exception as e:
            logger.error(f"Failed to load SegVol model: {e}")
            raise

    def _load_model(self, model_path: str):
        """Load SegVol model from checkpoint or HuggingFace"""
        # Placeholder - implement actual model loading
        # This will depend on SegVol's exact API
        try:
            from transformers import AutoModel
            model = AutoModel.from_pretrained(model_path, trust_remote_code=True)
            return model
        except Exception as e:
            logger.warning(f"HuggingFace loading failed: {e}, trying local checkpoint")
            # Fallback to local loading
            raise NotImplementedError("Local model loading not yet implemented")

    def predict_next_slice(
        self,
        reference_contour: np.ndarray,
        reference_slice_data: np.ndarray,
        target_slice_data: np.ndarray,
        reference_slice_position: float,
        target_slice_position: float,
        spacing: Tuple[float, float, float] = (1.0, 1.0, 1.0)
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

                # Normalize image data
                ref_slice = self._normalize_ct(reference_slice_data)
                target_slice = self._normalize_ct(target_slice_data)

                # Convert contour to mask
                ref_mask = self._contour_to_mask(reference_contour, ref_slice.shape)

                # Create synthetic volume (interpolate between slices)
                distance = abs(target_slice_position - reference_slice_position)
                num_interp_slices = max(1, int(distance / spacing[2]))

                # Simple linear interpolation
                volume = self._interpolate_slices(
                    ref_slice, target_slice, num_interp_slices
                )
                mask_volume = self._interpolate_slices(
                    ref_mask, np.zeros_like(target_slice), num_interp_slices
                )

                # Prepare tensors
                volume_tensor = torch.from_numpy(volume).unsqueeze(0).unsqueeze(0).float().to(self.device)
                mask_tensor = torch.from_numpy(mask_volume).unsqueeze(0).unsqueeze(0).float().to(self.device)

                # Run inference (simplified - adjust based on actual SegVol API)
                # SegVol expects specific input format
                output = self._run_segvol_inference(volume_tensor, mask_tensor, spacing)

                # Extract predicted mask for target slice
                target_slice_idx = -1 if target_slice_position > reference_slice_position else 0
                predicted_mask = output[0, 0, target_slice_idx, :, :].cpu().numpy()

                # Convert mask back to contour
                predicted_contour = self._mask_to_contour(predicted_mask)

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
        """Normalize CT image to appropriate range"""
        # Clip to typical CT range
        image = np.clip(image, -1000, 3000)
        # Normalize to [0, 1]
        image = (image + 1000) / 4000
        return image

    def _contour_to_mask(self, contour: np.ndarray, shape: Tuple[int, int]) -> np.ndarray:
        """Convert contour points to binary mask"""
        from skimage.draw import polygon

        mask = np.zeros(shape, dtype=np.float32)
        if len(contour) > 0:
            rr, cc = polygon(contour[:, 1], contour[:, 0], shape)
            mask[rr, cc] = 1.0
        return mask

    def _mask_to_contour(self, mask: np.ndarray, threshold: float = 0.5) -> np.ndarray:
        """Convert binary mask to contour points"""
        from skimage.measure import find_contours

        binary_mask = (mask > threshold).astype(np.uint8)
        contours = find_contours(binary_mask, 0.5)

        if len(contours) == 0:
            return np.array([])

        # Return largest contour
        largest_contour = max(contours, key=len)
        # Swap to (x, y) format
        contour = np.column_stack([largest_contour[:, 1], largest_contour[:, 0]])

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
        spacing: Tuple[float, float, float]
    ) -> torch.Tensor:
        """
        Run actual SegVol model inference
        This is a placeholder - implement based on actual SegVol API
        """
        # TODO: Implement actual SegVol inference
        # For now, return a simple propagation
        logger.warning("Using fallback inference - SegVol model integration pending")

        # Simple fallback: just propagate the mask
        return mask

    def _calculate_confidence(self, predicted_mask: np.ndarray, reference_mask: np.ndarray) -> float:
        """Calculate prediction confidence based on mask characteristics"""
        # Simple heuristic: check mask coherence and size
        mask_area = np.sum(predicted_mask > 0.5)
        ref_area = np.sum(reference_mask > 0.5)

        if mask_area == 0:
            return 0.0

        # Area similarity
        area_ratio = min(mask_area, ref_area) / max(mask_area, ref_area)

        # Compactness (perimeter^2 / area)
        # Lower values indicate more compact shapes
        from skimage.measure import perimeter
        perim = perimeter((predicted_mask > 0.5).astype(np.uint8))
        if mask_area > 0:
            compactness = (perim ** 2) / (4 * np.pi * mask_area)
            compactness_score = np.clip(1.0 / (1.0 + compactness * 0.1), 0, 1)
        else:
            compactness_score = 0.0

        # Combine scores
        confidence = 0.6 * area_ratio + 0.4 * compactness_score

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

        # Run prediction
        if segvol_model is None:
            return jsonify({'error': 'Model not loaded'}), 500

        result = segvol_model.predict_next_slice(
            reference_contour=reference_contour,
            reference_slice_data=reference_slice_data,
            target_slice_data=target_slice_data,
            reference_slice_position=reference_slice_position,
            target_slice_position=target_slice_position,
            spacing=spacing
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

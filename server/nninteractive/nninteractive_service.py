#!/usr/bin/env python3
"""
nnInteractive Flask Service for Interactive 3D Tumor Segmentation

This service provides interactive 3D segmentation using nnInteractive,
designed for tumor contouring with minimal user input.

Reference: https://github.com/MIC-DKFZ/nnInteractive
"""

import os
import sys
import logging
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS
import SimpleITK as sitk
from typing import Dict, List, Optional, Tuple
import traceback
from pathlib import Path

from huggingface_hub import snapshot_download

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

# Global model instance
model = None
device = None


class NNInteractiveModel:
    """Wrapper for nnInteractive model inference"""

    def __init__(self, device_name: str = 'cuda'):
        """
        Initialize nnInteractive model

        Args:
            device_name: 'cuda' or 'cpu'
        """
        self.device_name = device_name
        self.model = None
        self.initialized = False
        self.device = None
        self.weights_dir = Path(os.environ.get('NNINTERACTIVE_WEIGHTS_DIR', Path(__file__).parent / 'weights')).resolve()
        self.repo_id = os.environ.get('NNINTERACTIVE_REPO_ID', 'nnInteractive/nnInteractive')
        self.model_name = os.environ.get('NNINTERACTIVE_MODEL_NAME', 'nnInteractive_v1.0')
        self.allow_download = os.environ.get('NNINTERACTIVE_ALLOW_DOWNLOAD', '').lower() in {'1', 'true', 'yes'}

    def load_model(self):
        """Load the nnInteractive model"""
        try:
            import torch

            # Set device
            if self.device_name == 'cuda' and torch.cuda.is_available():
                self.device = torch.device('cuda')
                logger.info(f"Using GPU: {torch.cuda.get_device_name(0)}")
                logger.info(f"GPU Memory: {torch.cuda.get_device_properties(0).total_memory / 1e9:.2f} GB")
            elif self.device_name == 'mps' and getattr(torch.backends, 'mps', None) and torch.backends.mps.is_available():
                self.device = torch.device('mps')
                logger.info("Using Apple Metal (MPS) GPU")
            else:
                self.device = torch.device('cpu')
                if self.device_name == 'cuda':
                    logger.warning("CUDA requested but not available. Falling back to CPU (may be slower).")
                else:
                    logger.info("Using CPU (fast enough for small volumes; expect slower inference).")

            # Import nnInteractive
            # Add nnInteractive repo to import path
            nninteractive_path = os.path.join(os.path.dirname(__file__), 'nnInteractive')
            if os.path.exists(nninteractive_path):
                sys.path.insert(0, nninteractive_path)

            logger.info("Loading nnInteractive model...")

            try:
                from nnInteractive.inference.inference_session import nnInteractiveInferenceSession
            except ImportError as e:
                logger.error(f"Failed to import nnInteractive: {e}")
                logger.info("Install nnInteractive: https://github.com/MIC-DKFZ/nnInteractive")
                raise

            try:
                weights_path = self._resolve_weights()
            except Exception as weight_error:
                logger.error(f"Failed to prepare nnInteractive weights: {weight_error}")
                raise

            try:
                session = nnInteractiveInferenceSession(
                    device=self.device,
                    use_torch_compile=False,
                    verbose=False,
                    torch_n_threads=os.cpu_count() or 8,
                    do_autozoom=True,
                    use_pinned_memory=(self.device.type == 'cuda')
                )

                session.initialize_from_trained_model_folder(str(weights_path))
                self.model = session
                self.initialized = True
                logger.info(f"✅ nnInteractive model loaded successfully on {self.device.type.upper()}")

                if self.device.type != 'cuda':
                    logger.info("Note: Running nnInteractive on CPU/MPS. Expect higher latency than GPU inference.")

            except Exception as model_error:
                logger.warning(f"Failed to load nnInteractive model on {self.device}: {model_error}")
                logger.warning("Falling back to MOCK model implementation.")
                self.model = MockNNInteractive(self.device)
                self.initialized = True

        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            logger.error(traceback.format_exc())
            raise

    def _resolve_weights(self) -> Path:
        """
        Ensure nnInteractive weights are available locally, downloading if permitted.
        """
        target_dir = self.weights_dir / self.model_name
        if target_dir.exists():
            logger.info(f"Using cached nnInteractive weights at {target_dir}")
            return target_dir

        self.weights_dir.mkdir(parents=True, exist_ok=True)

        # Try local cache via HuggingFace hub
        try:
            snapshot_path = snapshot_download(
                repo_id=self.repo_id,
                allow_patterns=[f"{self.model_name}/*"],
                local_dir=str(self.weights_dir),
                local_files_only=True
            )
            logger.info(f"Found nnInteractive weights in local HuggingFace cache: {snapshot_path}")
        except LocalEntryNotFoundError:
            if not self.allow_download:
                raise RuntimeError(
                    "nnInteractive weights not found in local cache. "
                    f"Place the '{self.model_name}' folder under '{self.weights_dir}' "
                    "or set NNINTERACTIVE_ALLOW_DOWNLOAD=1 to enable online download."
                )
            logger.info("Local nnInteractive weights not found. Attempting download from HuggingFace...")
            snapshot_path = snapshot_download(
                repo_id=self.repo_id,
                allow_patterns=[f"{self.model_name}/*"],
                local_dir=str(self.weights_dir),
                local_files_only=False
            )
            logger.info(f"Downloaded nnInteractive weights to {snapshot_path}")

        candidate = Path(snapshot_path) / self.model_name
        if candidate.exists():
            return candidate

        # In some cases snapshot_download returns the exact directory
        snapshot_dir = Path(snapshot_path)
        if snapshot_dir.exists() and snapshot_dir.name == self.model_name:
            return snapshot_dir

        raise RuntimeError(
            f"Unable to locate nnInteractive weights in snapshot at {snapshot_path}. "
            f"Expected folder '{self.model_name}'."
        )

    def segment_from_scribbles(
        self,
        volume: np.ndarray,
        scribbles: List[Dict],
        spacing: Tuple[float, float, float],
        point_prompts: Optional[List[Dict]] = None,
        box_prompt: Optional[Dict] = None
    ) -> Dict:
        """
        Perform 3D segmentation from user prompts

        Args:
            volume: 3D numpy array (Z, Y, X) - CT/MRI volume
            scribbles: List of scribble strokes [{"slice": z, "points": [[x,y],...], "label": 1}]
            spacing: Voxel spacing (z, y, x) in mm
            point_prompts: Optional point prompts [{"slice": z, "point": [x,y], "label": 1}]
            box_prompt: Optional bounding box {"slice": z, "box": [x1,y1,x2,y2]}

        Returns:
            {
                "mask": 3D binary mask (Z, Y, X),
                "confidence": float 0-1,
                "recommended_slice": int or None
            }
        """
        if not self.initialized:
            raise RuntimeError("Model not initialized")

        try:
            # Check if using mock or real model
            if isinstance(self.model, MockNNInteractive):
                # Use mock model predict
                prompts = self._prepare_prompts(scribbles, point_prompts, box_prompt)
                mask, confidence = self.model.predict(
                    volume=volume,
                    prompts=prompts,
                    spacing=spacing
                )
            else:
                # Use real nnInteractive session
                import torch

                # Set image in session (expects shape (1, Z, Y, X))
                volume_4d = volume[None, ...] if volume.ndim == 3 else volume
                self.model.set_image(volume_4d)

                # Create output buffer
                target_tensor = torch.zeros(volume.shape, dtype=torch.uint8)
                self.model.set_target_buffer(target_tensor)

                # Process scribbles - create scribble images for each slice
                for scribble in scribbles:
                    slice_idx = scribble['slice']
                    points = np.array(scribble['points'])
                    label = scribble.get('label', 1)

                    # Create scribble image (same shape as volume)
                    scribble_image = np.zeros(volume.shape, dtype=np.uint8)

                    # Draw scribble on the specific slice
                    if len(points) > 0:
                        # Convert points to integer coordinates
                        points_int = points.astype(int)

                        # Fill pixels along scribble path
                        for i in range(len(points_int)):
                            x, y = points_int[i]
                            if 0 <= x < volume.shape[2] and 0 <= y < volume.shape[1]:
                                scribble_image[slice_idx, y, x] = 1

                                # Make scribble thicker (3x3 kernel)
                                for dx in [-1, 0, 1]:
                                    for dy in [-1, 0, 1]:
                                        nx, ny = x + dx, y + dy
                                        if 0 <= nx < volume.shape[2] and 0 <= ny < volume.shape[1]:
                                            scribble_image[slice_idx, ny, nx] = 1

                    # Add scribble interaction
                    include_interaction = (label == 1)  # True for foreground, False for background
                    self.model.add_scribble_interaction(scribble_image, include_interaction=include_interaction)

                # Get final mask from target buffer
                mask = target_tensor.cpu().numpy()
                confidence = 0.95  # Real model, assume high confidence

            # Recommend next slice for refinement
            recommended_slice = self._recommend_slice(mask, scribbles)

            return {
                'mask': mask,
                'confidence': confidence,
                'recommended_slice': recommended_slice
            }

        except Exception as e:
            logger.error(f"Segmentation failed: {e}")
            logger.error(traceback.format_exc())
            raise

    def _prepare_prompts(
        self,
        scribbles: List[Dict],
        point_prompts: Optional[List[Dict]],
        box_prompt: Optional[Dict]
    ) -> Dict:
        """Convert user inputs to nnInteractive prompt format"""
        prompts = {
            'scribbles': [],
            'points': [],
            'boxes': []
        }

        # Process scribbles
        for scribble in scribbles:
            prompts['scribbles'].append({
                'slice': scribble['slice'],
                'coords': np.array(scribble['points']),
                'label': scribble.get('label', 1)
            })

        # Process point prompts
        if point_prompts:
            for point in point_prompts:
                prompts['points'].append({
                    'slice': point['slice'],
                    'coord': np.array(point['point']),
                    'label': point.get('label', 1)
                })

        # Process box prompt
        if box_prompt:
            prompts['boxes'].append({
                'slice': box_prompt['slice'],
                'box': np.array(box_prompt['box'])
            })

        return prompts

    def _recommend_slice(self, mask: np.ndarray, existing_scribbles: List[Dict]) -> Optional[int]:
        """
        Recommend next slice to annotate for best improvement

        Strategy: Find slice with:
        - Tumor present (mask > 0)
        - Not already annotated
        - High uncertainty or shape change
        """
        try:
            # Get annotated slices
            annotated = set(s['slice'] for s in existing_scribbles)

            # Find slices with tumor
            tumor_slices = np.where(mask.sum(axis=(1, 2)) > 0)[0]

            if len(tumor_slices) == 0:
                return None

            # Filter out already annotated
            unannotated = [s for s in tumor_slices if s not in annotated]

            if len(unannotated) == 0:
                return None

            # Find slice with maximum area (likely most important)
            areas = [mask[s].sum() for s in unannotated]
            max_idx = np.argmax(areas)

            return int(unannotated[max_idx])

        except Exception as e:
            logger.warning(f"Could not recommend slice: {e}")
            return None


class MockNNInteractive:
    """Mock model for development/testing before nnInteractive is installed"""

    def __init__(self, device):
        self.device = device
        logger.info("Using MOCK nnInteractive model")
        logger.info("For better AI segmentation, use SegVol or Mem3D services instead")

    def predict(self, volume: np.ndarray, prompts: Dict, spacing: Tuple) -> Tuple[np.ndarray, float]:
        """
        Mock prediction - creates a region growing segmentation from scribbles
        """
        logger.info(f"MOCK prediction on volume shape: {volume.shape}")

        # Create empty mask
        mask = np.zeros(volume.shape, dtype=np.uint8)

        # For each foreground scribble, perform region growing
        for scribble in prompts.get('scribbles', []):
            if scribble.get('label', 1) != 1:  # Skip background scribbles for now
                continue
                
            slice_idx = scribble['slice']
            coords = scribble['coords']

            if len(coords) > 0 and 0 <= slice_idx < volume.shape[0]:
                # Perform region growing on this slice
                slice_data = volume[slice_idx]
                slice_mask = self._region_grow_2d(slice_data, coords)
                
                # Apply to neighboring slices with decay
                for dz in range(-3, 4):
                    z = slice_idx + dz
                    if 0 <= z < volume.shape[0]:
                        decay_factor = 1.0 - (abs(dz) * 0.25)  # Decay by 25% per slice
                        if decay_factor > 0:
                            # Slightly erode mask for other slices
                            if dz != 0:
                                eroded_mask = self._erode_mask(slice_mask, iterations=abs(dz))
                                mask[z] = np.maximum(mask[z], (eroded_mask * decay_factor).astype(np.uint8))
                            else:
                                mask[z] = np.maximum(mask[z], slice_mask)

        # Apply background scribbles to remove regions
        for scribble in prompts.get('scribbles', []):
            if scribble.get('label', 1) != 0:  # Only background scribbles
                continue
                
            slice_idx = scribble['slice']
            coords = scribble['coords']
            
            if len(coords) > 0 and 0 <= slice_idx < volume.shape[0]:
                # Create exclusion region around background scribbles
                coords = np.array(coords)
                for coord in coords:
                    x, y = coord.astype(int)
                    # Clear a region around each background point
                    for dy in range(-10, 11):
                        for dx in range(-10, 11):
                            ny, nx = y + dy, x + dx
                            if 0 <= ny < volume.shape[1] and 0 <= nx < volume.shape[2]:
                                # Clear in 3D neighborhood
                                for dz in range(-2, 3):
                                    z = slice_idx + dz
                                    if 0 <= z < volume.shape[0]:
                                        mask[z, ny, nx] = 0

        # Mock confidence based on how much was segmented
        segmented_ratio = np.sum(mask) / mask.size
        confidence = min(0.85, 0.5 + segmented_ratio * 10)  # Scale confidence

        return mask, confidence
    
    def _region_grow_2d(self, image: np.ndarray, seed_coords: np.ndarray, tolerance: float = 30) -> np.ndarray:
        """Simple region growing from seed points"""
        mask = np.zeros(image.shape, dtype=np.uint8)
        
        # Get seed points and their mean intensity
        seed_coords = np.array(seed_coords).astype(int)
        seed_values = []
        for coord in seed_coords:
            x, y = coord
            if 0 <= y < image.shape[0] and 0 <= x < image.shape[1]:
                seed_values.append(image[y, x])
                mask[y, x] = 1
        
        if not seed_values:
            return mask
            
        mean_intensity = np.mean(seed_values)
        
        # Region growing using flood fill
        from collections import deque
        queue = deque()
        
        # Add all seed points to queue
        for coord in seed_coords:
            x, y = coord
            if 0 <= y < image.shape[0] and 0 <= x < image.shape[1]:
                queue.append((x, y))
        
        # 8-connected neighbors
        neighbors = [(-1,-1), (-1,0), (-1,1), (0,-1), (0,1), (1,-1), (1,0), (1,1)]
        
        processed = set()
        while queue:
            x, y = queue.popleft()
            
            if (x, y) in processed:
                continue
            processed.add((x, y))
            
            for dx, dy in neighbors:
                nx, ny = x + dx, y + dy
                
                if (0 <= nx < image.shape[1] and 0 <= ny < image.shape[0] and 
                    mask[ny, nx] == 0 and (nx, ny) not in processed):
                    
                    # Check if pixel intensity is within tolerance
                    if abs(image[ny, nx] - mean_intensity) <= tolerance:
                        mask[ny, nx] = 1
                        queue.append((nx, ny))
        
        return mask
    
    def _erode_mask(self, mask: np.ndarray, iterations: int = 1) -> np.ndarray:
        """Simple binary erosion"""
        result = mask.copy()
        
        for _ in range(iterations):
            temp = np.zeros_like(result)
            for y in range(1, mask.shape[0] - 1):
                for x in range(1, mask.shape[1] - 1):
                    # Only keep if all 4-neighbors are set
                    if (result[y-1, x] and result[y+1, x] and 
                        result[y, x-1] and result[y, x+1]):
                        temp[y, x] = 1
            result = temp
            
        return result


# Flask Routes

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    try:
        status = {
            'status': 'healthy',
            'nninteractive_available': model is not None and model.initialized,
            'device': device,
            'mock_mode': isinstance(model.model, MockNNInteractive) if model else False
        }
        return jsonify(status), 200
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return jsonify({
            'status': 'unhealthy',
            'error': str(e)
        }), 500


@app.route('/segment', methods=['POST'])
def segment():
    """
    Interactive 3D segmentation endpoint

    Expected JSON:
    {
        "volume": [[[...]]] or base64,
        "scribbles": [{"slice": 10, "points": [[x,y],...], "label": 1}],
        "spacing": [z, y, x],
        "point_prompts": [...] (optional),
        "box_prompt": {...} (optional)
    }

    Returns:
    {
        "mask": [[[...]]] binary mask,
        "confidence": 0.85,
        "recommended_slice": 15
    }
    """
    try:
        if model is None or not model.initialized:
            return jsonify({
                'error': 'Model not initialized',
                'details': 'nnInteractive model failed to load'
            }), 503

        data = request.get_json()

        # Parse volume
        volume = np.array(data['volume'], dtype=np.float32)

        # Parse inputs
        scribbles = data.get('scribbles', [])
        spacing = tuple(data.get('spacing', [1.0, 1.0, 1.0]))
        point_prompts = data.get('point_prompts')
        box_prompt = data.get('box_prompt')

        logger.info(f"Segmentation request: volume shape={volume.shape}, "
                   f"scribbles={len(scribbles)}, spacing={spacing}")

        # Run segmentation
        result = model.segment_from_scribbles(
            volume=volume,
            scribbles=scribbles,
            spacing=spacing,
            point_prompts=point_prompts,
            box_prompt=box_prompt
        )

        # Convert mask to list for JSON
        mask_list = result['mask'].astype(np.uint8).tolist()

        response = {
            'mask': mask_list,
            'confidence': float(result['confidence']),
            'recommended_slice': result['recommended_slice']
        }

        logger.info(f"Segmentation complete: confidence={result['confidence']:.2f}, "
                   f"recommended_slice={result['recommended_slice']}")

        return jsonify(response), 200

    except Exception as e:
        logger.error(f"Segmentation failed: {e}")
        logger.error(traceback.format_exc())
        return jsonify({
            'error': str(e),
            'traceback': traceback.format_exc()
        }), 500


@app.route('/segment-slice', methods=['POST'])
def segment_slice():
    """
    Segment a single slice (faster for quick feedback)

    Expected JSON:
    {
        "slice": [[...]] 2D image,
        "scribbles": [{"points": [[x,y],...], "label": 1}],
        "spacing": [y, x]
    }
    """
    try:
        if model is None or not model.initialized:
            return jsonify({'error': 'Model not initialized'}), 503

        data = request.get_json()

        # For single slice, create a mini 3-slice volume
        slice_2d = np.array(data['slice'], dtype=np.float32)
        volume = np.stack([slice_2d, slice_2d, slice_2d])

        # Convert 2D scribbles to 3D (middle slice)
        scribbles = [
            {
                'slice': 1,
                'points': s['points'],
                'label': s.get('label', 1)
            }
            for s in data.get('scribbles', [])
        ]

        spacing = tuple([1.0] + list(data.get('spacing', [1.0, 1.0])))

        # Run segmentation
        result = model.segment_from_scribbles(
            volume=volume,
            scribbles=scribbles,
            spacing=spacing
        )

        # Extract middle slice
        mask_2d = result['mask'][1].astype(np.uint8).tolist()

        return jsonify({
            'mask': mask_2d,
            'confidence': float(result['confidence'])
        }), 200

    except Exception as e:
        logger.error(f"Single slice segmentation failed: {e}")
        return jsonify({'error': str(e)}), 500


def main():
    """Main entry point"""
    global model, device

    # Parse arguments
    import argparse
    parser = argparse.ArgumentParser(description='nnInteractive Segmentation Service')
    parser.add_argument('--device', type=str, default='cuda', choices=['cuda', 'cpu', 'mps'],
                       help='Device to use (cuda, cpu, or mps for Apple Metal)')
    parser.add_argument('--port', type=int, default=5003,
                       help='Port to run service on')
    parser.add_argument('--host', type=str, default='127.0.0.1',
                       help='Host to bind to')
    args = parser.parse_args()

    device = args.device

    # Load model
    logger.info("Initializing nnInteractive service...")
    try:
        model = NNInteractiveModel(device_name=args.device)
        model.load_model()
        logger.info("Model loaded successfully")
    except Exception as e:
        logger.error(f"Failed to load model: {e}")
        logger.warning("Service will run in degraded mode")

    # Start Flask server
    logger.info(f"Starting server on {args.host}:{args.port}")
    app.run(host=args.host, port=args.port, debug=False)


if __name__ == '__main__':
    main()

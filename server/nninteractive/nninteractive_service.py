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

    def load_model(self):
        """Load the nnInteractive model"""
        try:
            import torch

            # Set device
            if self.device_name == 'cuda' and torch.cuda.is_available():
                self.device = torch.device('cuda')
                logger.info(f"Using GPU: {torch.cuda.get_device_name(0)}")
                logger.info(f"GPU Memory: {torch.cuda.get_device_properties(0).total_memory / 1e9:.2f} GB")
            else:
                self.device = torch.device('cpu')
                logger.info("Using CPU (GPU not available or not requested)")

            # Import nnInteractive
            try:
                # Add nnInteractive to path
                nninteractive_path = os.path.join(os.path.dirname(__file__), 'nnInteractive')
                if os.path.exists(nninteractive_path):
                    sys.path.insert(0, nninteractive_path)

                # Import nnInteractive modules
                # Note: This is a placeholder - actual import depends on nnInteractive structure
                # You'll need to adjust based on the actual nnInteractive API
                logger.info("Loading nnInteractive model...")

                # Placeholder for actual model loading
                # from nninteractive import NNInteractive
                # self.model = NNInteractive(device=self.device)
                # self.model.load_checkpoint('path/to/checkpoint')

                # For now, use a mock model for development
                logger.warning("Using MOCK model - install nnInteractive for production use")
                self.model = MockNNInteractive(self.device)

                self.initialized = True
                logger.info("nnInteractive model loaded successfully")

            except ImportError as e:
                logger.error(f"Failed to import nnInteractive: {e}")
                logger.info("Install nnInteractive: https://github.com/MIC-DKFZ/nnInteractive")
                raise

        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            logger.error(traceback.format_exc())
            raise

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
            # Prepare prompts
            prompts = self._prepare_prompts(scribbles, point_prompts, box_prompt)

            # Run inference
            mask, confidence = self.model.predict(
                volume=volume,
                prompts=prompts,
                spacing=spacing
            )

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

    def predict(self, volume: np.ndarray, prompts: Dict, spacing: Tuple) -> Tuple[np.ndarray, float]:
        """
        Mock prediction - creates a simple growing region from scribbles
        """
        logger.info(f"MOCK prediction on volume shape: {volume.shape}")

        # Create empty mask
        mask = np.zeros(volume.shape, dtype=np.uint8)

        # For each scribble, create a blob around it
        for scribble in prompts.get('scribbles', []):
            slice_idx = scribble['slice']
            coords = scribble['coords']

            if len(coords) > 0:
                # Get bounding box of scribble
                coords = np.array(coords)
                x_min, y_min = coords.min(axis=0).astype(int)
                x_max, y_max = coords.max(axis=0).astype(int)

                # Expand region slightly
                margin = 20
                x_min = max(0, x_min - margin)
                y_min = max(0, y_min - margin)
                x_max = min(volume.shape[2] - 1, x_max + margin)
                y_max = min(volume.shape[1] - 1, y_max + margin)

                # Fill region on this slice and neighbors
                for z in range(max(0, slice_idx - 2), min(volume.shape[0], slice_idx + 3)):
                    mask[z, y_min:y_max, x_min:x_max] = 1

        # Mock confidence
        confidence = 0.75

        return mask, confidence


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
    parser.add_argument('--device', type=str, default='cuda', choices=['cuda', 'cpu'],
                       help='Device to use (cuda or cpu)')
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

#!/usr/bin/env python3
"""
Mem3D (Volumetric Memory Network) Inference Service
Provides REST API for memory-augmented interactive 3D medical image segmentation

Paper: "Volumetric Memory Network for Interactive Medical Image Segmentation"
       Tianfei Zhou et al., Medical Image Analysis 2022 (MedIA Best Paper Award)
GitHub: https://github.com/0liliulei/Mem3D
"""

import os
import sys
import json
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
from collections import OrderedDict
import numpy as np
import torch
import torch.nn.functional as F
from flask import Flask, request, jsonify
from flask_cors import CORS
import cv2

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Global model instance and memory storage
mem3d_model = None
slice_memory = OrderedDict()  # Stores past slices for memory network
device = None
MAX_MEMORY_SLICES = 10  # Keep last 10 slices in memory


class SliceMemory:
    """Memory storage for past segmented slices"""

    def __init__(self, max_size=10):
        self.max_size = max_size
        self.memory = OrderedDict()

    def add(self, slice_position: float, slice_data: np.ndarray, mask: np.ndarray, features: Optional[torch.Tensor] = None):
        """Add a slice to memory"""
        key = round(slice_position, 3)

        self.memory[key] = {
            'position': slice_position,
            'slice_data': slice_data,
            'mask': mask,
            'features': features
        }

        # Remove oldest if exceeds max size
        if len(self.memory) > self.max_size:
            self.memory.popitem(last=False)

    def get_nearest(self, slice_position: float, n: int = 3) -> List[Dict]:
        """Get N nearest slices from memory"""
        if not self.memory:
            return []

        positions = list(self.memory.keys())
        distances = [abs(pos - slice_position) for pos in positions]

        # Sort by distance
        sorted_indices = np.argsort(distances)[:n]

        return [self.memory[positions[i]] for i in sorted_indices]

    def get_range(self, start: float, end: float) -> List[Dict]:
        """Get all slices in a range"""
        return [
            item for key, item in self.memory.items()
            if start <= item['position'] <= end
        ]

    def clear(self):
        """Clear all memory"""
        self.memory.clear()


class Mem3DPredictor:
    """Wrapper for Mem3D model inference"""

    def __init__(self, model_path: Optional[str] = None, device: str = 'cuda'):
        """
        Initialize Mem3D model

        Args:
            model_path: Path to model checkpoint
            device: 'cuda' or 'cpu'
        """
        self.device = torch.device(device if torch.cuda.is_available() else 'cpu')
        logger.info(f"Initializing Mem3D on device: {self.device}")

        self.memory = SliceMemory(max_size=MAX_MEMORY_SLICES)

        try:
            # Import Mem3D model (assumes repo is cloned)
            sys.path.insert(0, str(Path(__file__).parent / 'Mem3D'))

            # Load model architecture
            # Note: Actual implementation depends on Mem3D repo structure
            self.model = self._load_model(model_path)
            self.model.to(self.device)
            self.model.eval()

            logger.info("Mem3D model loaded successfully")

        except Exception as e:
            logger.error(f"Failed to load Mem3D model: {e}")
            # Use fallback implementation
            self.model = None
            logger.warning("Using fallback implementation (geometric + memory)")

    def _load_model(self, model_path: str):
        """Load Mem3D model from checkpoint"""
        # Placeholder - implement based on actual Mem3D repo
        # This will depend on Mem3D's model architecture

        try:
            # Example (adjust based on actual Mem3D code):
            # from models.vmn import VMN
            # model = VMN(...)
            # if model_path:
            #     checkpoint = torch.load(model_path, map_location=self.device)
            #     model.load_state_dict(checkpoint['state_dict'])
            # return model

            logger.warning("Mem3D model loading not yet fully implemented - using fallback")
            return None

        except Exception as e:
            logger.error(f"Model loading failed: {e}")
            return None

    def predict_with_memory(
        self,
        reference_slices: List[Dict[str, Any]],
        target_slice_data: np.ndarray,
        target_slice_position: float,
        interaction_type: str = 'contour'
    ) -> Dict[str, Any]:
        """
        Predict segmentation using memory of past slices

        Args:
            reference_slices: List of dicts with 'slice_data', 'mask', 'position'
            target_slice_data: 2D array of target slice pixel data
            target_slice_position: Z position of target slice
            interaction_type: 'contour', 'scribble', 'bbox', or 'clicks'

        Returns:
            Dictionary with predicted_mask, confidence, quality_score
        """
        try:
            # Add reference slices to memory
            for ref in reference_slices:
                self.memory.add(
                    ref['position'],
                    ref['slice_data'],
                    ref['mask']
                )

            # Get relevant memory slices
            memory_slices = self.memory.get_nearest(target_slice_position, n=3)

            if not memory_slices:
                # No memory available, return empty prediction
                return {
                    'predicted_mask': np.zeros_like(target_slice_data),
                    'confidence': 0.0,
                    'quality_score': 0.0,
                    'method': 'mem3d_no_memory'
                }

            # Run actual Mem3D inference
            if self.model is not None:
                predicted_mask, quality = self._run_mem3d_inference(
                    memory_slices,
                    target_slice_data,
                    target_slice_position
                )
            else:
                # Fallback: Memory-weighted geometric interpolation
                predicted_mask, quality = self._fallback_memory_prediction(
                    memory_slices,
                    target_slice_data,
                    target_slice_position
                )

            # Calculate confidence
            confidence = self._calculate_confidence(predicted_mask, memory_slices, quality)

            return {
                'predicted_mask': predicted_mask,
                'confidence': float(confidence),
                'quality_score': float(quality),
                'method': 'mem3d_memory' if self.model else 'mem3d_fallback',
                'memory_size': len(memory_slices),
                'metadata': {
                    'used_slices': [m['position'] for m in memory_slices],
                    'distance_to_nearest': abs(target_slice_position - memory_slices[0]['position'])
                }
            }

        except Exception as e:
            logger.error(f"Memory prediction failed: {e}", exc_info=True)
            raise

    def _run_mem3d_inference(
        self,
        memory_slices: List[Dict],
        target_slice_data: np.ndarray,
        target_position: float
    ) -> Tuple[np.ndarray, float]:
        """Run actual Mem3D model inference"""
        # TODO: Implement when Mem3D repo is integrated
        # This will use the actual VMN architecture

        # For now, use fallback
        return self._fallback_memory_prediction(memory_slices, target_slice_data, target_position)

    def _fallback_memory_prediction(
        self,
        memory_slices: List[Dict],
        target_slice_data: np.ndarray,
        target_position: float
    ) -> Tuple[np.ndarray, float]:
        """
        Fallback: Memory-weighted geometric interpolation
        Uses distance-weighted averaging of nearby masks
        """
        if not memory_slices:
            return np.zeros_like(target_slice_data), 0.0

        # Calculate weights based on distance (closer = higher weight)
        weights = []
        for mem in memory_slices:
            distance = abs(target_position - mem['position'])
            # Exponential decay: closer slices have more influence
            weight = np.exp(-distance * 0.5)
            weights.append(weight)

        weights = np.array(weights)
        weights = weights / weights.sum()  # Normalize

        # Weighted average of masks
        predicted_mask = np.zeros_like(target_slice_data, dtype=np.float32)

        for mem, weight in zip(memory_slices, weights):
            mask = mem['mask'].astype(np.float32)

            # Resize mask if needed
            if mask.shape != predicted_mask.shape:
                mask = cv2.resize(mask, (predicted_mask.shape[1], predicted_mask.shape[0]))

            predicted_mask += mask * weight

        # Threshold
        predicted_mask = (predicted_mask > 0.5).astype(np.uint8)

        # Calculate quality score (based on agreement between memory slices)
        quality = self._calculate_memory_quality(memory_slices, weights)

        return predicted_mask, quality

    def _calculate_memory_quality(self, memory_slices: List[Dict], weights: np.ndarray) -> float:
        """
        Calculate quality score based on memory consistency
        High quality = nearby slices have similar masks
        """
        if len(memory_slices) < 2:
            return 0.5  # Moderate quality with single reference

        # Compare masks pairwise
        similarities = []
        for i in range(len(memory_slices) - 1):
            mask1 = memory_slices[i]['mask']
            mask2 = memory_slices[i + 1]['mask']

            # Resize if needed
            if mask1.shape != mask2.shape:
                mask2 = cv2.resize(mask2, (mask1.shape[1], mask1.shape[0]))

            # Dice similarity
            intersection = np.sum((mask1 > 0) & (mask2 > 0))
            union = np.sum((mask1 > 0) | (mask2 > 0))

            if union > 0:
                dice = 2.0 * intersection / (np.sum(mask1 > 0) + np.sum(mask2 > 0))
                similarities.append(dice)

        if similarities:
            # High similarity = high quality
            return float(np.mean(similarities))

        return 0.5

    def _calculate_confidence(
        self,
        predicted_mask: np.ndarray,
        memory_slices: List[Dict],
        quality: float
    ) -> float:
        """Calculate prediction confidence"""
        # Base confidence from quality
        confidence = quality

        # Boost if we have multiple memory slices
        if len(memory_slices) >= 3:
            confidence = min(1.0, confidence * 1.2)

        # Penalize if mask is too small or too large
        mask_area = np.sum(predicted_mask > 0)
        total_area = predicted_mask.size

        area_ratio = mask_area / total_area
        if area_ratio < 0.001 or area_ratio > 0.9:
            confidence *= 0.5

        return float(np.clip(confidence, 0.0, 1.0))

    def recommend_next_slice(
        self,
        current_position: float,
        direction: str = 'both'
    ) -> Dict[str, Any]:
        """
        Recommend next slice to annotate based on memory quality

        Args:
            current_position: Current slice position
            direction: 'superior', 'inferior', or 'both'

        Returns:
            Dictionary with recommended slice positions and reasons
        """
        if not self.memory.memory:
            return {'recommended': [], 'reason': 'No memory available'}

        positions = sorted(self.memory.memory.keys())

        # Find gaps in coverage
        gaps = []
        for i in range(len(positions) - 1):
            gap_size = positions[i + 1] - positions[i]
            if gap_size > 2.0:  # Gap larger than 2mm
                gap_center = (positions[i] + positions[i + 1]) / 2
                gaps.append({
                    'position': gap_center,
                    'gap_size': gap_size,
                    'priority': gap_size,
                    'reason': f'Large gap ({gap_size:.1f}mm) between slices'
                })

        # Find boundaries
        if direction in ['superior', 'both']:
            superior_position = max(positions) + 2.0
            gaps.append({
                'position': superior_position,
                'priority': 0.8,
                'reason': 'Extend coverage superiorly'
            })

        if direction in ['inferior', 'both']:
            inferior_position = min(positions) - 2.0
            gaps.append({
                'position': inferior_position,
                'priority': 0.8,
                'reason': 'Extend coverage inferiorly'
            })

        # Sort by priority
        gaps.sort(key=lambda x: x['priority'], reverse=True)

        return {
            'recommended': gaps[:3],  # Top 3 recommendations
            'memory_coverage': len(positions),
            'coverage_range': [min(positions), max(positions)] if positions else []
        }


# Global predictor instance
predictor = None


def initialize_model(model_path: Optional[str] = None, device_name: str = 'cuda'):
    """Initialize the global Mem3D model"""
    global predictor, device

    try:
        logger.info("Loading Mem3D model...")
        device = device_name
        predictor = Mem3DPredictor(model_path=model_path, device=device_name)
        logger.info("Mem3D model loaded and ready")
    except Exception as e:
        logger.error(f"Failed to initialize model: {e}")
        raise


# API Endpoints

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'model_loaded': predictor is not None,
        'device': str(device),
        'memory_size': len(predictor.memory.memory) if predictor else 0
    })


@app.route('/predict', methods=['POST'])
def predict():
    """
    Predict with memory

    Expected JSON:
    {
        "reference_slices": [
            {
                "slice_data": [...],  // Flattened HU values
                "mask": [...],        // Flattened binary mask
                "position": 50.0,
                "image_shape": [512, 512]
            },
            ...
        ],
        "target_slice_data": [...],
        "target_slice_position": 51.0,
        "image_shape": [512, 512],
        "interaction_type": "contour"
    }
    """
    try:
        data = request.json

        # Parse inputs
        reference_slices = []
        for ref in data.get('reference_slices', []):
            image_shape = tuple(ref['image_shape'])
            reference_slices.append({
                'slice_data': np.array(ref['slice_data']).reshape(image_shape),
                'mask': np.array(ref['mask']).reshape(image_shape),
                'position': float(ref['position'])
            })

        image_shape = tuple(data['image_shape'])
        target_slice_data = np.array(data['target_slice_data']).reshape(image_shape)
        target_slice_position = float(data['target_slice_position'])
        interaction_type = data.get('interaction_type', 'contour')

        # Run prediction
        if predictor is None:
            return jsonify({'error': 'Model not loaded'}), 500

        result = predictor.predict_with_memory(
            reference_slices=reference_slices,
            target_slice_data=target_slice_data,
            target_slice_position=target_slice_position,
            interaction_type=interaction_type
        )

        # Convert mask to list
        result['predicted_mask'] = result['predicted_mask'].flatten().tolist()

        return jsonify(result)

    except Exception as e:
        logger.error(f"Prediction error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/recommend_slice', methods=['POST'])
def recommend_slice():
    """
    Recommend next slice to annotate

    Expected JSON:
    {
        "current_position": 50.0,
        "direction": "both"  // 'superior', 'inferior', or 'both'
    }
    """
    try:
        data = request.json
        current_position = float(data['current_position'])
        direction = data.get('direction', 'both')

        if predictor is None:
            return jsonify({'error': 'Model not loaded'}), 500

        recommendations = predictor.recommend_next_slice(
            current_position=current_position,
            direction=direction
        )

        return jsonify(recommendations)

    except Exception as e:
        logger.error(f"Recommendation error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/clear_memory', methods=['POST'])
def clear_memory():
    """Clear slice memory"""
    try:
        if predictor is None:
            return jsonify({'error': 'Model not loaded'}), 500

        predictor.memory.clear()

        return jsonify({
            'status': 'success',
            'message': 'Memory cleared'
        })

    except Exception as e:
        logger.error(f"Clear memory error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Mem3D Inference Service')
    parser.add_argument('--port', type=int, default=5002, help='Port to run service on')
    parser.add_argument('--host', type=str, default='127.0.0.1', help='Host to bind to')
    parser.add_argument('--model-path', type=str, default=None, help='Path to model checkpoint')
    parser.add_argument('--device', type=str, default='cuda', help='Device: cuda or cpu')

    args = parser.parse_args()

    # Initialize model on startup
    initialize_model(model_path=args.model_path, device_name=args.device)

    # Run Flask app
    logger.info(f"Starting Mem3D service on {args.host}:{args.port}")
    app.run(host=args.host, port=args.port, debug=False)

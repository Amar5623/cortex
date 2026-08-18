#!/usr/bin/env bash
set -e

echo "=== 1. Cleaning previous build cache ==="
rm -rf .aws-sam

echo "=== 2. Building SAM container ==="
sam build --use-container

echo "=== 3. Pruning build target to stay under AWS Lambda 250MB limit ==="
TARGET=".aws-sam/build/CortexFunction"

# 3a. Remove model_cache & archives (fastembed will download to /tmp on cold start or use zero-vector fallback)
rm -rf "$TARGET/model_cache"* 2>/dev/null || true

# 3b. Remove unused image/transfer libraries
rm -rf "$TARGET/PIL" "$TARGET/pillow"* "$TARGET/hf_xet" 2>/dev/null || true

# 3c. Remove unused heavy submodules in onnxruntime, numpy, sympy, fastembed, huggingface_hub
rm -rf "$TARGET/onnxruntime/tools" "$TARGET/onnxruntime/quantization" "$TARGET/onnxruntime/transformers" "$TARGET/onnxruntime/datasets" "$TARGET/onnxruntime/backend" "$TARGET/onnxruntime/capi/libonnxruntime_providers_cuda.so" "$TARGET/onnxruntime/capi/libonnxruntime_providers_tensorrt.so" 2>/dev/null || true
rm -rf "$TARGET/numpy/f2py" "$TARGET/numpy/doc" "$TARGET/numpy/tests" "$TARGET/numpy/distutils" "$TARGET/numpy/typing" "$TARGET/numpy/_core/include" "$TARGET/numpy/array_api" 2>/dev/null || true
rm -rf "$TARGET/sympy" "$TARGET/scipy" "$TARGET/matplotlib" "$TARGET/pandas" 2>/dev/null || true
rm -rf "$TARGET/fastembed/image" "$TARGET/fastembed/sparse" "$TARGET/fastembed/late_interaction" 2>/dev/null || true
rm -rf "$TARGET/huggingface_hub/cli" "$TARGET/huggingface_hub/templates" 2>/dev/null || true

# 3d. Remove test folders, documentation, C headers, and compiled bytecode (DO NOT delete .dist-info -- mcp needs metadata!)
find "$TARGET" -type d \( -name "tests" -o -name "test" -o -name "__pycache__" -o -name "docs" -o -name "examples" \) -exec rm -rf {} + 2>/dev/null || true
find "$TARGET" -type f \( -name "*.pyc" -o -name "*.pyo" -o -name "*.c" -o -name "*.h" -o -name "*.exe" -o -name "*.a" -o -name "*.dylib" \) -delete 2>/dev/null || true

echo "=== 4. Deploying to AWS us-east-1 ==="
sam deploy --config-env default --no-confirm-changeset

echo "=== 5. Deploying to AWS us-west-2 ==="
sam deploy --config-env west --no-confirm-changeset

echo "=== SUCCESS! Both regions deployed cleanly. ==="

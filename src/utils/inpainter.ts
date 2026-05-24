/**
 * High-performance client-side image inpainting and healing.
 * Uses a wavefront propagation (onion-peeling) algorithm with weighted
 * distance colors, followed by local spatial smoothing to seamlessly blend
 * textures.
 */
export function inpaintImage(
  srcCtx: CanvasRenderingContext2D,
  maskCtx: CanvasRenderingContext2D,
  width: number,
  height: number
): ImageData {
  const srcImgData = srcCtx.getImageData(0, 0, width, height);
  const maskImgData = maskCtx.getImageData(0, 0, width, height);

  const srcPixels = srcImgData.data;
  const maskPixels = maskImgData.data;

  const totalPixels = width * height;
  
  // Create state buffer: 0 = unmasked (known color), 1 = masked (to fill), 2 = frontier
  const pixelStatus = new Uint8Array(totalPixels);
  const originalMask = new Uint8Array(totalPixels);

  // Initialize statuses
  for (let i = 0; i < totalPixels; i++) {
    // Red channel from mask > 127 indicates masked region
    const maskVal = maskPixels[i * 4];
    const maskAlpha = maskPixels[i * 4 + 3];
    if (maskVal > 120 && maskAlpha > 120) {
      pixelStatus[i] = 1; // Masked
      originalMask[i] = 1;
    } else {
      pixelStatus[i] = 0; // Unmasked
    }
  }

  // Find initial frontier wavefront (pixels that are masked, but have at least one unmasked 4-neighbor)
  let frontier: number[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (pixelStatus[idx] === 1) {
        // Check 4-neighbors
        let isBoundary = false;
        
        if (x > 0 && pixelStatus[idx - 1] === 0) isBoundary = true;
        else if (x < width - 1 && pixelStatus[idx + 1] === 0) isBoundary = true;
        else if (y > 0 && pixelStatus[idx - width] === 0) isBoundary = true;
        else if (y < height - 1 && pixelStatus[idx + width] === 0) isBoundary = true;

        if (isBoundary) {
          frontier.push(idx);
          pixelStatus[idx] = 2; // Marked as frontier
        }
      }
    }
  }

  // Wavefront expansion & interpolation (Fast multi-pass radial propagation)
  const tempColors = new Uint8ClampedArray(totalPixels * 3); // Temporarily store completed colors

  while (frontier.length > 0) {
    const nextFrontier: number[] = [];

    for (let i = 0; i < frontier.length; i++) {
      const idx = frontier[i];
      const x = idx % width;
      const y = Math.floor(idx / width);

      // Interpolate from unmasked 5x5 neighborhood with distance weighting
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let wSum = 0;

      const halfWindow = 3; // 7x7 window for structural propagation

      for (let dy = -halfWindow; dy <= halfWindow; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;

        for (let dx = -halfWindow; dx <= halfWindow; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;

          const nIdx = ny * width + nx;
          if (pixelStatus[nIdx] === 0) {
            // Distance-based inverse squared weight
            const distSq = dx * dx + dy * dy;
            const weight = distSq === 0 ? 1 : 1 / distSq;

            const nIdx4 = nIdx * 4;
            rSum += srcPixels[nIdx4] * weight;
            gSum += srcPixels[nIdx4 + 1] * weight;
            bSum += srcPixels[nIdx4 + 2] * weight;
            wSum += weight;
          }
        }
      }

      if (wSum > 0) {
        tempColors[idx * 3] = rSum / wSum;
        tempColors[idx * 3 + 1] = gSum / wSum;
        tempColors[idx * 3 + 2] = bSum / wSum;
      } else {
        // Fallback: search wider to prevent stuck regions
        let fallbackFound = false;
        let searchRadius = 5;
        for (let r = 4; r <= 15 && !fallbackFound; r++) {
          for (let dy = -r; dy <= r; dy += 2) {
            const ny = y + dy;
            if (ny < 0 || ny >= height) continue;
            for (let dx = -r; dx <= r; dx += 2) {
              const nx = x + dx;
              if (nx < 0 || nx >= width) continue;
              const nIdx = ny * width + nx;
              if (pixelStatus[nIdx] === 0) {
                const nIdx4 = nIdx * 4;
                tempColors[idx * 3] = srcPixels[nIdx4];
                tempColors[idx * 3 + 1] = srcPixels[nIdx4 + 1];
                tempColors[idx * 3 + 2] = srcPixels[nIdx4 + 2];
                fallbackFound = true;
                break;
              }
            }
            if (fallbackFound) break;
          }
        }
      }
    }

    // Apply values calculated in this wavefront layer
    for (let i = 0; i < frontier.length; i++) {
      const idx = frontier[i];
      const idx3 = idx * 3;
      const idx4 = idx * 4;

      srcPixels[idx4] = tempColors[idx3];
      srcPixels[idx4 + 1] = tempColors[idx3 + 1];
      srcPixels[idx4 + 2] = tempColors[idx3 + 2];
      srcPixels[idx4 + 3] = 255; // fully opaque

      pixelStatus[idx] = 0; // Move into unmasked state
    }

    // Re-check remaining masked pixels to establish the next frontier layer
    for (let i = 0; i < frontier.length; i++) {
      const idx = frontier[i];
      const x = idx % width;
      const y = Math.floor(idx / width);

      // Check 4-neighbors of newly filled pixel
      const checkNeighbor = (nx: number, ny: number) => {
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const nIdx = ny * width + nx;
          if (pixelStatus[nIdx] === 1) {
            nextFrontier.push(nIdx);
            pixelStatus[nIdx] = 2; // prevent duplicate queue insertions
          }
        }
      };

      checkNeighbor(x - 1, y);
      checkNeighbor(x + 1, y);
      checkNeighbor(x, y - 1);
      checkNeighbor(x, y + 1);
    }

    frontier = nextFrontier;
  }

  // Spatial Smoothing Pass (Blur/blend only the modified mask and outer boundaries)
  // Run 3 iterations for nice, seamless, artifact-free textures
  const smoothingPasses = 3;
  const blendBuffer = new Uint8ClampedArray(srcPixels);

  for (let pass = 0; pass < smoothingPasses; pass++) {
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        if (originalMask[idx] === 1) {
          // Average color of 3x3 window with central weight
          let rTotal = 0, gTotal = 0, bTotal = 0, weightTotal = 0;

          for (let dy = -1; dy <= 1; dy++) {
            const ny = y + dy;
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx;
              const nIdx = ny * width + nx;
              
              const isCenter = dx === 0 && dy === 0;
              const w = isCenter ? 3 : 1; // strong center preserving
              
              const nIdx4 = nIdx * 4;
              rTotal += blendBuffer[nIdx4] * w;
              gTotal += blendBuffer[nIdx4 + 1] * w;
              bTotal += blendBuffer[nIdx4 + 2] * w;
              weightTotal += w;
            }
          }

          const idx4 = idx * 4;
          srcPixels[idx4] = rTotal / weightTotal;
          srcPixels[idx4 + 1] = gTotal / weightTotal;
          srcPixels[idx4 + 2] = bTotal / weightTotal;
        }
      }
    }
    // Update blend buffer for the next pass
    if (pass < smoothingPasses - 1) {
      blendBuffer.set(srcPixels);
    }
  }

  return srcImgData;
}

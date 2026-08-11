function pixelChanged(a, b, threshold) {
  return Math.max(
    Math.abs(Number(a[0]) - Number(b[0])),
    Math.abs(Number(a[1]) - Number(b[1])),
    Math.abs(Number(a[2]) - Number(b[2])),
  ) > threshold;
}

export function preservationMetrics(source, result, mask, width, height, {
  threshold = 8,
  boundaryRadius = 2,
} = {}) {
  if (!Array.isArray(source) || !Array.isArray(result) || !Array.isArray(mask)) {
    throw new Error("Le metriche richiedono pixel sorgente, risultato e maschera.");
  }
  const total = width * height;
  if (source.length < total || result.length < total || mask.length < total) {
    throw new Error("Dimensioni pixel non coerenti con width e height.");
  }
  let outside = 0;
  let changedOutside = 0;
  let boundary = 0;
  let boundaryDifference = 0;
  const inside = (index) => Number(mask[index]) > 0.5;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const selected = inside(index);
      if (!selected) {
        outside += 1;
        if (pixelChanged(source[index], result[index], threshold)) changedOutside += 1;
      }
      let nearBoundary = false;
      for (let oy = -boundaryRadius; oy <= boundaryRadius && !nearBoundary; oy += 1) {
        for (let ox = -boundaryRadius; ox <= boundaryRadius; ox += 1) {
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (inside(ny * width + nx) !== selected) {
            nearBoundary = true;
            break;
          }
        }
      }
      if (nearBoundary) {
        boundary += 1;
        boundaryDifference += pixelChanged(source[index], result[index], threshold) ? 1 : 0;
      }
    }
  }
  const outsideChangedRatio = outside ? changedOutside / outside : 0;
  return {
    changedPixelsOutsideMask: changedOutside,
    outsidePixelCount: outside,
    outsideChangedRatio,
    outsideRoiPreservationScore: Math.round((1 - outsideChangedRatio) * 10000) / 100,
    boundaryDifferenceScore: boundary
      ? Math.round((1 - boundaryDifference / boundary) * 10000) / 100
      : 100,
    identityPreservation: null,
  };
}

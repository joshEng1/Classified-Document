// Cloud Vision quick-scan shim.
// This project can run without Cloud Vision credentials/services.
// Keep the extractor import stable and return a disabled signal.

export async function quickDetectImagesWithCloudVision(_args = {}) {
  return {
    enabled: false,
    has_images: false,
    reason: 'cloud_vision_unavailable',
    sampled_pages: [],
    detections: [],
  };
}


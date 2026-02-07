# Fusion Overlay Grey Background Notes

When a fused secondary volume is rendered without the primary CT (for example, when the overlay-only toggle is active), any voxels that do not receive data from the Fusebox slice stream remain at their default value of `0`.

On the client we convert the Fusebox payload into a canvas via [`fuseboxSliceToImageData`](../client/src/lib/fusion-utils.ts). For secondary CT overlays the background voxels are explicitly mapped to fully transparent pixels so they do not obscure the base image—the alpha channel is forced to `0` whenever the normalized signal is `0`.

As soon as the overlay canvas is drawn with those transparent pixels, the viewer falls back to the layout background colour (a neutral grey). That is why secondary CT overlays appear to have a grey border wherever the reconstruction volume ends, and why scrolling above/below the reconstructed range yields an entirely grey slice—the Fusebox slice is empty, so every pixel is transparent and you see the UI backdrop instead of actual data. PET overlays do not show this grey border because their colormap retains low-but-nonzero intensities instead of forcing them fully transparent.

This behaviour is expected and shows that the incoming Fusebox slice did not contain signal for that part of the volume rather than indicating a rendering bug.

# App icon & splash — drop your Canva exports here

Put two PNGs in this folder, then run `npm run assets` (from the `mobile/` folder):

- **icon.png** — 1024×1024. Your logo on a solid background. No transparency, no
  rounded corners (the stores round it automatically).
- **splash.png** — 2732×2732. Logo centred on the dark brand background (#0c1413).
  Keep the logo within the middle ~60% so it isn't cropped on any device.

`@capacitor/assets` then generates every iOS & Android icon/splash size for you.

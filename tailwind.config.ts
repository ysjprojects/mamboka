import forms from '@tailwindcss/forms';
import type {Config} from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx,scss}'],
  theme: {
    extend: {
      screens: {
        // The Switch-style side columns need a landscape viewport; portrait tablets keep the phone
        // layout (one HUD row on top) so the box can use the full width.
        wide: {raw: '(min-width: 768px) and (min-aspect-ratio: 1/1)'},
      },
    },
  },
  // `forms` resets the name and title inputs on the game-over card and in the group editor.
  plugins: [forms],
} satisfies Config;

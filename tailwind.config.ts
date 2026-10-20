import forms from '@tailwindcss/forms';
import type {Config} from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx,scss}'],
  // `forms` resets the name and title inputs on the game-over card and in the group editor.
  plugins: [forms],
} satisfies Config;

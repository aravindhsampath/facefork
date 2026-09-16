import { createContext } from 'react';
// Shared by canvas nodes / lightbox: {selectedCount, compare, favourites, generate, remove, open, toggleStar, download}
export const Ctx = createContext(null);

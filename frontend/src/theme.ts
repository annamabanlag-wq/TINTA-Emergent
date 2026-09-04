// Colors derived from /app/design_guidelines.json - Brutalist Mobile (DARK)
export const colors = {
  surface: "#0A0A0A",
  onSurface: "#FFFFFF",
  surfaceSecondary: "#171717",
  onSurfaceSecondary: "#F5F5F5",
  surfaceTertiary: "#262626",
  onSurfaceTertiary: "#E0E0E0",
  surfaceInverse: "#FFFFFF",
  onSurfaceInverse: "#0A0A0A",
  brand: "#E51C24",
  onBrand: "#FFFFFF",
  brandPrimary: "#E51C24",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#B31219",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#330C0E",
  onBrandTertiary: "#FF4D55",
  success: "#008A2E",
  onSuccess: "#FFFFFF",
  warning: "#D99000",
  onWarning: "#000000",
  error: "#E51C24",
  onError: "#FFFFFF",
  info: "#404040",
  onInfo: "#FFFFFF",
  border: "#333333",
  borderStrong: "#FFFFFF",
  divider: "#262626",
  muted: "#808080",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
} as const;

export const radius = {
  sm: 0,
  md: 0,
  lg: 0,
  pill: 0,
} as const;

export const typography = {
  scale: { sm: 12, base: 14, lg: 16, xl: 20, "2xl": 24, "3xl": 32, "4xl": 48 },
};

export const useTheme = () => ({ colors, spacing, radius, typography });

export const IMAGES = {
  hero: "https://images.unsplash.com/photo-1568515045052-f9a854d70bfd?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDk1ODB8MHwxfHNlYXJjaHwxfHx0YXR0b28lMjBhcnRpc3QlMjB3b3JraW5nfGVufDB8fHx8MTc4ODUwNjQ4OHww&ixlib=rb-4.1.0&q=85",
  eye: "https://images.unsplash.com/photo-1775135436883-56af5c10a476?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjY2NzZ8MHwxfHNlYXJjaHwxfHx0YXR0b28lMjBwb3J0Zm9saW8lMjBibGFjayUyMGFuZCUyMGdyZXl8ZW58MHx8fHwxNzg4NTA2NDg5fDA&ixlib=rb-4.1.0&q=85",
  fineline: "https://images.unsplash.com/photo-1547754145-ef9ff306e3f3?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjY2NzV8MHwxfHNlYXJjaHw0fHxmaW5lJTIwbGluZSUyMHRhdHRvb3xlbnwwfHx8fDE3ODg1MDY0ODh8MA&ixlib=rb-4.1.0&q=85",
  avatar: "https://images.unsplash.com/photo-1621787279722-c06fe6c18cf7?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjY2NzZ8MHwxfHNlYXJjaHwyfHx0YXR0b28lMjBwb3J0Zm9saW8lMjBibGFjayUyMGFuZCUyMGdyZXl8ZW58MHx8fHwxNzg4NTA2NDg5fDA&ixlib=rb-4.1.0&q=85",
  moody: "https://images.unsplash.com/photo-1605647533135-51b5906087d0?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDk1ODB8MHwxfHNlYXJjaHwzfHx0YXR0b28lMjBhcnRpc3QlMjB3b3JraW5nfGVufDB8fHx8MTc4ODUwNjQ4OHww&ixlib=rb-4.1.0&q=85",
};

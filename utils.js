export function isEmpty(data) {
    if (Array.isArray(data)) {
        return !data.length;
    }
    return !data;
}

/** Added to everything the extension draws when the theme is light (see stylesheet.css) */
export const LIGHT_THEME_CLASS = "organizedtodo-light";

/**
 * theme: the "theme" key; colorScheme: GNOME's org.gnome.desktop.interface color-scheme.
 * "default" means no preference, which GNOME apps draw light, so only prefer-dark keeps System dark.
 */
export function isLight(theme, colorScheme) {
    return theme === "light" || (theme === "system" && colorScheme !== "prefer-dark");
}

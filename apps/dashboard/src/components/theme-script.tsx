/**
 * Applies the saved theme to <html> before first paint (no flash of the wrong
 * theme). Default is light; users opt into dark via the toggle. Rendered as the
 * first child of <body> so it runs synchronously before styled content paints.
 */
export function ThemeScript() {
  const js = `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;
  // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted static, no user input
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}

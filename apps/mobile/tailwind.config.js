/** @type {import('tailwindcss').Config} */
module.exports = {
  // nativewind/preset must be in the preset chain or NativeWind's Metro
  // integration refuses to start ("Tailwind CSS has not been configured
  // with the NativeWind preset").
  presets: [require("nativewind/preset"), require("@homeup/ui/tailwind-preset")],
  // Includes packages/ui/src so the kit's own className usage is scanned too
  // (this app is the only consumer that actually builds a NativeWind
  // stylesheet today — packages/ui has no bundler/dev-server of its own).
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "../../packages/ui/src/**/*.{js,jsx,ts,tsx}",
  ],
};

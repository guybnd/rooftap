// Cold-start: runtime half of babel-plugin-lucide-imports.js. Every module
// that imports lucide icons calls this at load with just those icons, so
// NativeWind's cssInterop wrapper (HOUP-307: lifts a `className` tone into
// lucide's `color` prop) is registered for the ~150 icons the app uses
// instead of the whole ~1,640-icon barrel. Registration is global by
// component reference, so it runs before any render of the importing module.
import { cssInterop } from 'nativewind';
import { createIconRegistrar } from './register-icon-interop';

export const registerLucideIcons = createIconRegistrar(cssInterop);

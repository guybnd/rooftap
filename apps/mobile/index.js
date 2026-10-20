// HOUP-106: apps/mobile's `main` was `expo-router/entry` — that module's own
// import side effect calls registerRootComponent(App). This wrapper keeps
// that behavior and additionally registers the widget's headless task
// handler, which must run at module scope so it's registered before the
// widget provider ever fires WIDGET_ADDED/WIDGET_UPDATE/WIDGET_CLICK — which
// can happen with the app process cold, before expo-router has mounted any
// route (so _layout.tsx's own side-effect imports may not have run yet).
import 'expo-router/entry';
import { registerWidgetTaskHandler } from 'react-native-android-widget';
import { widgetTaskHandler } from './src/widgets/widgetTaskHandler';

registerWidgetTaskHandler(widgetTaskHandler);

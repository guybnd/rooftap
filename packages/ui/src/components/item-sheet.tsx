// The add and edit item sheet (Hearth §7 E1-E4, the "quick line that grows"
// design). One component for every module's item: a tinted title band that
// states the item, then either
//   - the quick line (adding): the title over a few chips sitting on the
//     keyboard. A chip swaps the keyboard for its editor in a tray of the
//     keyboard's own height, so the sheet never jumps. "More" grows the
//     sheet into the list.
//   - the list (adding with More, and always when editing): one ListGroup of
//     PropertyRows that show their value and open in place under themselves.
// Adding ends on Add (or Return). Editing has no Save: every close path
// (Done, backdrop, drag, back) hands the caller `onSubmit`, which writes the
// changes, so an edit saves as you leave it (M4: live controls).
// Web twin: apps/web/src/components/ui/item-sheet.tsx. Values, quick choices
// and the title check come from core's item-sheet.ts.
import * as React from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  Text as RNText,
  TextInput,
  useWindowDimensions,
  View,
  type KeyboardEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { ChevronRight, CircleAlert, Ellipsis, ArrowUp, X, type LucideIcon } from 'lucide-react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import {
  dialog,
  dueQuickChoices,
  newWordPops,
  wordPopKey,
  wordPopKeys,
  TIME_QUICK_CHOICES,
  timeChoiceLabel,
  todayISO,
  toISODate,
  weekStrip,
  weekStripMonth,
  weekStripOffsetFor,
} from '@homeup/core';
import { cn } from '../lib/cn';
import { commit, select, tick, warn } from '../lib/haptics';
import { useStillMotion } from '../theme/theme-provider';
import { BottomSheet } from './bottom-sheet';
import { BottomSheetScrollView } from './bottom-sheet-scroll-view';
import { Button } from './button';
import { LeadingTile, type LeadingTileIcon } from './leading-tile';
import { ListGroup, ListItem, ListItemBody, ListItemContent, ListItemLeading, ListItemTrailing } from './list-item';
import { MonthDatePicker } from './month-date-picker';
import { Text } from './text';
import { TimeScrollField } from './time-scroll-field';
import { WordPop } from './word-pop';

/** Body's resting cap in list mode, as a fraction of the window. */
const BODY_REST_FRACTION = 0.62;
const BODY_MIN_HEIGHT = 180;
/** Tray height before the keyboard has ever been seen this session. */
const DEFAULT_TRAY_HEIGHT = 280;
let lastKeyboardHeight = DEFAULT_TRAY_HEIGHT;
/** The title's padding (px-4 pt-1): where its first letter sits in the field. */
const TITLE_PAD_X = 16;
const TITLE_PAD_TOP = 4;
/** The title's type: the field, and the copies a word pop measures and draws. */
const TITLE_TEXT = 'font-heading text-display';
let nextPopId = 0;

/** A title word popping as it lights (Hearth §8 "Word pop"), with the title as it was then. */
interface TitlePopShot {
  id: number;
  /** The word's key (core wordPopKey): its twin in the field hides while it pops. */
  key: string;
  title: string;
  start: number;
  end: number;
}

/** A chip on the quick line. Its editor opens in the tray. */
export interface ItemSheetQuickField {
  id: string;
  /** The chip's words: the field's value ("Tomorrow", "Guy"). */
  label: string;
  /** Small leading glyph or face. */
  icon?: React.ReactNode;
  /** The value differs from "nothing set" (draws the chip in its set state). */
  set?: boolean;
  /** Words in the title set this value: the chip lights with them. */
  lit?: boolean;
  /** The tray's heading ("Due"). */
  trayLabel: string;
  editor: React.ReactNode;
}

/** Words in the title that set a field: lit in place (core matchTitleWords). */
export interface ItemSheetTitleMark {
  start: number;
  end: number;
}

export interface ItemSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 'add' starts on the quick line (when there are quick fields); 'edit' starts on the list and saves on close. */
  mode: 'add' | 'edit';
  /** The item's section: its leading tile heads the band (E1). */
  section?: { id: string; Icon: LeadingTileIcon };
  /** Replaces the section tile, for items with their own glyph (grocery, recipe). */
  glyph?: React.ReactNode;
  /** "New to-do" or "To-do". */
  heading: string;
  /** One line of facts under the heading ("Household"). */
  caption?: string;
  title: string;
  onTitleChange: (title: string) => void;
  titlePlaceholder: string;
  /** Said under the title, in the danger tone (core itemTitleError). */
  titleError?: string | null;
  /** Bump to nudge the band and fire warn() (each failed add). */
  nudge?: number;
  /** Extra band content under the title (a Hero amount, a count). */
  bandExtra?: React.ReactNode;
  /** Fields the title's words set (core matchTitleWords). */
  /** Words in the title that set a field, drawn lit on the words themselves. */
  titleMarks?: readonly ItemSheetTitleMark[];
  /** The quick line's chips. Without them an add opens on the list. */
  quickFields?: ItemSheetQuickField[];
  /** The list: PropertyGroups. */
  children: React.ReactNode;
  /** Add: the Add button or Return. Edit: every close path. */
  onSubmit: () => void;
  /** "Add to-do". Unused when editing. */
  submitLabel?: string;
  /** Edit only: a Delete row, alone at the end (E4), confirmed here. */
  onDelete?: () => void;
  deleteLabel?: string;
  deleteConfirmTitle?: string;
  deleteConfirmMessage?: string;
}

export function ItemSheet({
  open,
  onOpenChange,
  mode,
  section,
  glyph,
  heading,
  caption,
  title,
  onTitleChange,
  titlePlaceholder,
  titleError,
  nudge = 0,
  bandExtra,
  titleMarks,
  quickFields,
  children,
  onSubmit,
  submitLabel = 'Add',
  onDelete,
  deleteLabel = 'Delete',
  deleteConfirmTitle,
  deleteConfirmMessage,
}: ItemSheetProps) {
  const editing = mode === 'edit';
  const hasQuick = !editing && !!quickFields && quickFields.length > 0;
  const [expanded, setExpanded] = React.useState(!hasQuick);
  const [tray, setTray] = React.useState<string | null>(null);
  const [trayHeight, setTrayHeight] = React.useState(lastKeyboardHeight);
  const titleRef = React.useRef<TextInput>(null);
  const { height: windowHeight } = useWindowDimensions();
  const still = useStillMotion();

  // Words that start setting a field pop as they light (Hearth §8 "Word
  // pop"): tick() always, the rainbow fill and pop unless motion is still. Words already
  // lit when the sheet opens (a kept draft) stay quiet.
  const [pops, setPops] = React.useState<TitlePopShot[]>([]);
  const [titleWidth, setTitleWidth] = React.useState(0);
  const popKeys = React.useRef<string[] | null>(null);
  React.useEffect(() => {
    if (!open) {
      popKeys.current = null;
      setPops([]);
      return;
    }
    const marks = titleMarks ?? [];
    const before = popKeys.current;
    popKeys.current = wordPopKeys(title, marks);
    if (before === null) return;
    const fresh = newWordPops(before, title, marks);
    if (!fresh.length) return;
    tick();
    if (still) return;
    setPops((now) => [...now, ...fresh.map((m) => ({ id: ++nextPopId, key: wordPopKey(title, m), title, start: m.start, end: m.end }))]);
  }, [open, title, titleMarks, still]);
  const popDone = React.useCallback((id: number) => setPops((now) => now.filter((p) => p.id !== id)), []);

  // Remember the keyboard's height so the tray can take its exact place.
  const keyboardUp = React.useRef(false);
  React.useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e: KeyboardEvent) => {
      keyboardUp.current = true;
      const h = Math.round(e.endCoordinates.height);
      if (h > 120) {
        lastKeyboardHeight = h;
        setTrayHeight(h);
      }
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardUp.current = false;
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // A failed add nudges the band sideways and fires warn().
  const shake = useSharedValue(0);
  const lastNudge = React.useRef(nudge);
  React.useEffect(() => {
    if (nudge === lastNudge.current) return;
    lastNudge.current = nudge;
    warn();
    if (still) return;
    shake.value = withSequence(
      withTiming(-6, { duration: 50 }),
      withTiming(6, { duration: 70 }),
      withTiming(-3, { duration: 60 }),
      withTiming(0, { duration: 60 })
    );
  }, [nudge, still, shake]);
  const bandStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  // The list rests at most at 62% of the window. With the keyboard up the
  // sheet takes the space above it (BottomSheet keyboardGrows) and the list
  // shrinks to fit under the band, so More shows rows, not one.
  const bodyStyle = { flexShrink: 1, maxHeight: Math.max(BODY_MIN_HEIGHT, windowHeight * BODY_REST_FRACTION) };

  const requestClose = React.useCallback(() => {
    if (editing) onSubmit();
    else onOpenChange(false);
  }, [editing, onSubmit, onOpenChange]);

  // A tap outside first puts the keyboard (or a chip's tray) away and lets
  // the sheet settle at the bottom. The next tap outside closes it.
  const backdropPress = () => {
    if (keyboardUp.current || tray) {
      Keyboard.dismiss();
      setTray(null);
      return;
    }
    requestClose();
  };

  const submit = React.useCallback(() => {
    if (!editing) commit();
    onSubmit();
  }, [editing, onSubmit]);

  const openTray = (id: string) => {
    select();
    if (tray === id) {
      setTray(null);
      titleRef.current?.focus();
      return;
    }
    Keyboard.dismiss();
    setTray(id);
  };

  // More keeps you typing: the list grows under the title and the keyboard
  // stays (or comes back from a tray) on the title.
  const grow = () => {
    select();
    setTray(null);
    setExpanded(true);
    requestAnimationFrame(() => titleRef.current?.focus());
  };

  const requestDelete = () => {
    if (!onDelete) return;
    dialog.alert(deleteConfirmTitle ?? `${deleteLabel}?`, deleteConfirmMessage ?? "This can't be undone.", [
      { text: 'Cancel', style: 'cancel' },
      { text: deleteLabel, style: 'destructive', onPress: onDelete },
    ]);
  };

  const trayField = tray ? quickFields?.find((f) => f.id === tray) : undefined;
  const trayContext = React.useMemo(
    () => ({
      close: () => {
        setTray(null);
        titleRef.current?.focus();
      },
    }),
    []
  );

  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : requestClose())}
      keyboardGrows
      onBackdropPress={backdropPress}
      className="max-h-[92%]"
    >
      <View style={{ flexShrink: 1 }}>
        {/* The band: what the item is, and where you type its name. */}
        <Animated.View
          style={bandStyle}
          className={cn('border-b bg-muted/50', titleError ? 'border-destructive' : 'border-border')}
        >
          <View className="flex-row items-center gap-3 px-4 pb-1.5 pt-1">
            {glyph ?? (section ? <LeadingTile sectionId={section.id} Icon={section.Icon} size="md" /> : null)}
            <View className="min-w-0 flex-1">
              <Text numberOfLines={1} className="text-body font-semibold text-foreground">
                {heading}
              </Text>
              {!!caption && (
                <Text numberOfLines={1} className="text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                  {caption}
                </Text>
              )}
            </View>
            {editing ? (
              <Button variant="ghost" size="sm" onPress={requestClose}>
                Done
              </Button>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={requestClose}
                className="h-11 w-11 items-center justify-center"
              >
                <X size={18} className="text-muted-foreground" />
              </Pressable>
            )}
          </View>
          <View onLayout={(e: LayoutChangeEvent) => setTitleWidth(e.nativeEvent.layout.width)}>
          <TextInput
            ref={titleRef}
            // The text comes as spans (not `value`) so title words can light
            // up; always spans, so the field never swaps modes mid-typing.
            onChangeText={onTitleChange}
            placeholder={titlePlaceholder}
            accessibilityLabel={heading}
            autoFocus={!editing && hasQuick}
            multiline={false}
            returnKeyType={editing ? 'done' : 'send'}
            submitBehavior={editing ? 'blurAndSubmit' : 'submit'}
            onSubmitEditing={editing ? undefined : submit}
            onFocus={() => setTray(null)}
            className="px-4 pb-3 pt-1 font-heading text-display text-foreground placeholder:text-muted-foreground"
          >
            <TitleSpans title={title} marks={titleMarks ?? []} popping={pops} />
          </TextInput>
          {/* Over the title: each popping word's copy, while its twin in the field hides. */}
          {titleWidth > 0 &&
            pops.map((p) => <TitlePop key={p.id} shot={p} fieldWidth={titleWidth} onDone={popDone} />)}
          </View>
          {!!titleError && (
            <View className="flex-row items-center gap-1.5 px-4 pb-3" accessibilityLiveRegion="polite">
              <CircleAlert size={14} className="text-destructive" />
              <Text className="text-caption font-medium text-destructive">{titleError}</Text>
            </View>
          )}
          {bandExtra}
        </Animated.View>

        {!expanded ? (
          <>
            {/* The quick line: chips on the keyboard, then Add. */}
            <View className="flex-row items-center gap-1.5 px-3 py-2">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerClassName="gap-1.5 pr-2">
                {quickFields!.map((f) => (
                  <Chip key={f.id} label={f.label} icon={f.icon} on={tray === f.id} lit={f.lit} set={f.set} onPress={() => openTray(f.id)} />
                ))}
                <Chip label="More" icon={<Ellipsis size={14} className="text-muted-foreground" />} ghost onPress={grow} accessibilityHint="Shows every field" />
              </ScrollView>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={submitLabel}
                onPress={submit}
                className="h-11 w-11 items-center justify-center rounded-full bg-primary"
              >
                <ArrowUp size={20} className="text-primary-foreground" />
              </Pressable>
            </View>
            {trayField && (
              <View style={{ height: trayHeight }} className="border-t border-border">
                <View className="flex-row items-center px-4 pb-1 pt-3">
                  <Text className="flex-1 text-body font-semibold text-foreground">{trayField.trayLabel}</Text>
                  <Button variant="ghost" size="sm" onPress={trayContext.close}>
                    Keyboard
                  </Button>
                </View>
                <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-3 px-4 pb-4">
                  <TrayContext.Provider value={trayContext}>{trayField.editor}</TrayContext.Provider>
                </ScrollView>
              </View>
            )}
          </>
        ) : (
          <>
            <BottomSheetScrollView style={bodyStyle} contentContainerClassName="gap-3 px-3 py-3" keyboardShouldPersistTaps="handled">
              {children}
              {editing && onDelete && (
                <ListGroup>
                  <ListItem accessibilityRole="button" onPress={requestDelete} className="items-center">
                    <ListItemContent>
                      <Text className="text-body font-medium text-destructive">{deleteLabel}</Text>
                    </ListItemContent>
                  </ListItem>
                </ListGroup>
              )}
            </BottomSheetScrollView>
            {!editing && (
              <View className="border-t border-border px-3 pb-3 pt-2.5">
                <Button size="lg" className="h-12 rounded-xl" onPress={submit}>
                  {submitLabel}
                </Button>
              </View>
            )}
          </>
        )}
      </View>
    </BottomSheet>
  );
}

/** The title as spans, with the matched words lit like their chip. */
function TitleSpans({
  title,
  marks,
  popping,
}: {
  title: string;
  marks: readonly ItemSheetTitleMark[];
  /** Words popping over the field right now: drawn clear here so only the copy shows. */
  popping: readonly { key: string }[];
}) {
  const hidden = new Set(popping.map((p) => p.key));
  const spans: React.ReactNode[] = [];
  let at = 0;
  [...marks]
    .sort((a, b) => a.start - b.start)
    .forEach((m, i) => {
      if (m.start < at) return;
      if (m.start > at) spans.push(title.slice(at, m.start));
      spans.push(
        <RNText key={i} className={hidden.has(wordPopKey(title, m)) ? 'text-transparent' : 'bg-primary/15 text-primary'}>
          {title.slice(m.start, m.end)}
        </RNText>
      );
      at = m.end;
    });
  if (at < title.length) spans.push(title.slice(at));
  return <>{spans}</>;
}

/**
 * One word's pop. A TextInput can't say where its words sit, so this first
 * measures the title up to the word's end, the word and the whole title in
 * hidden text of the same type, then draws the popping copy right over the word. The
 * field shows its end while you type, so a title wider than the field is
 * read as scrolled to its end.
 */
function TitlePop({ shot, fieldWidth, onDone }: { shot: TitlePopShot; fieldWidth: number; onDone: (id: number) => void }) {
  const [size, setSize] = React.useState<{ upTo?: number; word?: number; height?: number; full?: number }>({});
  const parts = [
    ['upTo', shot.title.slice(0, shot.end)],
    ['word', shot.title.slice(shot.start, shot.end)],
    ['full', shot.title],
  ] as const;
  const { upTo, word, height, full } = size;
  if (upTo === undefined || word === undefined || height === undefined || full === undefined) {
    return (
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: 4000, opacity: 0 }} importantForAccessibility="no-hide-descendants">
        {parts.map(([key, text]) => (
          <View key={key} style={{ flexDirection: 'row' }}>
            <RNText
              numberOfLines={1}
              className={TITLE_TEXT}
              onLayout={(e: LayoutChangeEvent) => {
                const { width, height: h } = e.nativeEvent.layout;
                setSize((now) => ({ ...now, [key]: width, ...(key === 'word' ? { height: h } : null) }));
              }}
            >
              {text}
            </RNText>
          </View>
        ))}
      </View>
    );
  }
  const scrolled = Math.max(0, full - (fieldWidth - TITLE_PAD_X * 2));
  const x = TITLE_PAD_X + upTo - word - scrolled;
  // Partly scrolled out of the field: let it just light.
  if (x < TITLE_PAD_X - 1 || x + word > fieldWidth - TITLE_PAD_X + 1) {
    return <PopSkip onSkip={() => onDone(shot.id)} />;
  }
  return (
    <WordPop
      text={shot.title.slice(shot.start, shot.end)}
      x={x}
      y={TITLE_PAD_TOP}
      width={word}
      height={height}
      textClassName={TITLE_TEXT}
      onDone={() => onDone(shot.id)}
    />
  );
}

function PopSkip({ onSkip }: { onSkip: () => void }) {
  React.useEffect(() => onSkip(), [onSkip]);
  return null;
}

function Chip({
  label,
  icon,
  on,
  lit,
  set,
  ghost,
  onPress,
  accessibilityHint,
}: {
  label: string;
  icon?: React.ReactNode;
  on?: boolean;
  lit?: boolean;
  set?: boolean;
  ghost?: boolean;
  onPress: () => void;
  accessibilityHint?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: on }}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      hitSlop={{ top: 6, bottom: 6 }}
      className={cn(
        'h-9 flex-row items-center gap-1.5 rounded-full border px-3',
        on || lit ? 'border-primary/45 bg-primary/10' : 'border-border bg-card',
        ghost && 'border-dashed'
      )}
    >
      {icon}
      <Text
        numberOfLines={1}
        className={cn('text-caption font-medium', on || lit ? 'text-primary' : set || !ghost ? 'text-foreground' : 'text-muted-foreground')}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ── The list ─────────────────────────────────────────────────────────────

interface PropertyGroupContextValue {
  openId: string | null;
  setOpenId: (id: string | null) => void;
}
const PropertyGroupContext = React.createContext<PropertyGroupContextValue | null>(null);

/**
 * A ListGroup of PropertyRows where one row is open at a time. Groups in one
 * sheet can share the open row by sharing `openId`/`onOpenIdChange`.
 */
export function PropertyGroup({
  label,
  children,
}: {
  /** Micro label above the group ("Contract"). */
  label?: string;
  children: React.ReactNode;
}) {
  const shared = React.useContext(PropertyGroupContext);
  const [ownOpen, setOwnOpen] = React.useState<string | null>(null);
  const value = React.useMemo(
    () => shared ?? { openId: ownOpen, setOpenId: setOwnOpen },
    [shared, ownOpen]
  );
  return (
    <View className="gap-1.5">
      {!!label && <Text className="px-1 text-micro-label uppercase text-muted-foreground">{label}</Text>}
      <PropertyGroupContext.Provider value={value}>
        <ListGroup>{children}</ListGroup>
      </PropertyGroupContext.Provider>
    </View>
  );
}

/** Lets every PropertyGroup inside share one open row. ItemSheet callers wrap the list in it. */
export function PropertyRows({ children }: { children: React.ReactNode }) {
  const [openId, setOpenId] = React.useState<string | null>(null);
  const value = React.useMemo(() => ({ openId, setOpenId }), [openId]);
  return (
    <PropertyGroupContext.Provider value={value}>
      <View className="gap-3">{children}</View>
    </PropertyGroupContext.Provider>
  );
}

const TrayContext = React.createContext<{ close: () => void } | null>(null);

/**
 * Close the row or quick-line tray this editor sits in, after a final choice
 * (a person). A tray hands the keyboard back to the title.
 */
export function useClosePropertyRow(): () => void {
  const ctx = React.useContext(PropertyGroupContext);
  const tray = React.useContext(TrayContext);
  return React.useCallback(() => {
    ctx?.setOpenId(null);
    tray?.close();
  }, [ctx, tray]);
}

export interface PropertyRowProps {
  id: string;
  /** A PropertyIcon or a face. */
  leading: React.ReactNode;
  label: string;
  /** Right-aligned value words (E2). */
  value?: string;
  /** False draws the value muted ("Never", "None"). Default true. */
  valueSet?: boolean;
  /** A small problem with this value, said under the label. */
  error?: string | null;
  /** A control that lives in the row itself (a three-way segment). The row then never opens. */
  control?: React.ReactNode;
  /** The editor that opens under the row. */
  children?: React.ReactNode;
}

/** A line item that states one property and opens its editor in place (E2, E3). */
export function PropertyRow({ id, leading, label, value, valueSet = true, error, control, children }: PropertyRowProps) {
  const ctx = React.useContext(PropertyGroupContext);
  const isOpen = ctx?.openId === id;
  const opens = !control && children != null;
  const toggle = () => {
    if (!opens || !ctx) return;
    select();
    ctx.setOpenId(isOpen ? null : id);
  };
  return (
    <View>
      <ListItem
        expanded={isOpen}
        onPress={opens ? toggle : undefined}
        disabled={!opens}
        accessibilityRole={opens ? 'button' : undefined}
        accessibilityState={opens ? { expanded: isOpen } : undefined}
        accessibilityLabel={value ? `${label}: ${value}` : label}
        className="items-center"
      >
        <ListItemLeading className="mt-0">{leading}</ListItemLeading>
        <ListItemContent>
          <Text className="text-body font-medium text-foreground">{label}</Text>
          {!!error && <Text className="text-caption text-destructive">{error}</Text>}
        </ListItemContent>
        <ListItemTrailing className="mt-0 max-w-[60%]">
          {control ?? (
            <>
              {value != null && (
                <Text
                  numberOfLines={1}
                  style={{ fontVariant: ['tabular-nums'] }}
                  className={cn(
                    'text-body',
                    error ? 'font-medium text-destructive' : isOpen ? 'font-semibold text-primary' : valueSet ? 'font-medium text-foreground' : 'text-muted-foreground'
                  )}
                >
                  {value}
                </Text>
              )}
              {opens && (
                <ChevronRight size={16} className="text-muted-foreground" style={isOpen ? { transform: [{ rotate: '90deg' }] } : undefined} />
              )}
            </>
          )}
        </ListItemTrailing>
      </ListItem>
      {opens && (
        <ListItemBody expanded={isOpen} className="gap-3 bg-muted/40 px-3 pb-3 pl-[52px] pt-1">
          {children}
        </ListItemBody>
      )}
    </View>
  );
}

/** The neutral tile a property row leads with. Section hues stay for identity (H2). */
export function PropertyIcon({ Icon }: { Icon: LucideIcon }) {
  return (
    <View className="h-7 w-7 items-center justify-center rounded-[9px] bg-muted">
      <Icon size={15} className="text-muted-foreground" strokeWidth={2.1} />
    </View>
  );
}

// ── Editors ─────────────────────────────────────────────────────────────

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
}

/** Quick choices as chips. Picking fires tick(). */
export function ChoiceChips<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: {
  options: readonly ChoiceOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  accessibilityLabel?: string;
}) {
  return (
    <View className="flex-row flex-wrap gap-1.5" accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value || '_none'}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            onPress={() => {
              tick();
              onChange(o.value);
            }}
            hitSlop={{ top: 4, bottom: 4 }}
            className={cn('h-9 justify-center rounded-full border px-3', on ? 'border-primary/45 bg-primary/10' : 'border-border bg-card')}
          >
            <Text className={cn('text-caption font-medium', on ? 'text-primary' : 'text-foreground')}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export interface WeekStripDayLike {
  iso: string;
  letter: string;
  day: number;
  isToday: boolean;
}

/** Seven days to tap, with arrows to step a week (Due editor). */
export function WeekStrip({
  days,
  value,
  month,
  onPick,
  onPrev,
  onNext,
  onMonth,
}: {
  days: WeekStripDayLike[];
  value: string;
  month: string;
  onPick: (iso: string) => void;
  onPrev?: () => void;
  onNext: () => void;
  onMonth?: () => void;
}) {
  return (
    <View className="gap-1.5">
      <View className="flex-row">
        {days.map((d) => {
          const on = d.iso === value;
          return (
            <Pressable
              key={d.iso}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={d.iso}
              onPress={() => {
                tick();
                onPick(d.iso);
              }}
              className={cn(
                'mx-px min-h-11 flex-1 items-center justify-center gap-0.5 rounded-xl',
                on ? 'bg-primary' : d.isToday ? 'border border-border' : ''
              )}
            >
              <Text className={cn('text-[10px] font-semibold', on ? 'text-primary-foreground' : 'text-muted-foreground')}>{d.letter}</Text>
              <Text style={{ fontVariant: ['tabular-nums'] }} className={cn('text-body font-medium', on ? 'text-primary-foreground' : 'text-foreground')}>
                {d.day}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View className="flex-row items-center gap-1">
        <Text className="flex-1 text-caption text-muted-foreground">{month}</Text>
        {onPrev && (
          <Button variant="ghost" size="sm" onPress={onPrev}>
            Earlier
          </Button>
        )}
        <Button variant="ghost" size="sm" onPress={onNext}>
          Later
        </Button>
        {onMonth && (
          <Button variant="ghost" size="sm" onPress={onMonth}>
            Month
          </Button>
        )}
      </View>
    </View>
  );
}

export interface PersonOption {
  /** '' for Anyone. */
  id: string;
  name: string;
  face: React.ReactNode;
}

/** Faces to tap (Who editor). */
export function PeoplePicker({
  people,
  value,
  onChange,
}: {
  people: PersonOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3 py-1" accessibilityRole="radiogroup">
      {people.map((p) => {
        const on = p.id === value;
        return (
          <Pressable
            key={p.id || '_anyone'}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={p.name}
            onPress={() => {
              tick();
              onChange(p.id);
            }}
            className="min-w-12 items-center gap-1"
          >
            <View className={cn('rounded-full border-2', on ? 'border-primary' : 'border-transparent')} style={{ padding: 2 }}>
              {p.face}
            </View>
            <Text numberOfLines={1} className={cn('max-w-16 text-[11px] font-medium', on ? 'text-foreground' : 'text-muted-foreground')}>
              {p.name}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/**
 * The Due editor: quick choices, then a week strip that steps by weeks, and
 * Month for the month grid. Dates are YYYY-MM-DD, '' for no date.
 */
export function DueEditor({
  value,
  onChange,
  allowNone = true,
}: {
  value: string;
  onChange: (value: string) => void;
  allowNone?: boolean;
}) {
  const today = todayISO();
  const [offset, setOffset] = React.useState(() => weekStripOffsetFor(value, today));
  const [monthOpen, setMonthOpen] = React.useState(false);
  const days = weekStrip(today, offset);
  const choices = dueQuickChoices(today).filter((c) => allowNone || c.value);
  const picked = choices.find((c) => c.value === value)?.value ?? null;
  const pick = (next: string) => {
    onChange(next);
    if (next) setOffset(weekStripOffsetFor(next, today));
  };
  return (
    <View className="gap-3">
      <ChoiceChips
        options={choices.map((c) => ({ value: c.value, label: c.label }))}
        value={picked}
        onChange={pick}
        accessibilityLabel="Quick dates"
      />
      <WeekStrip
        days={days}
        value={value}
        month={weekStripMonth(days)}
        onPick={pick}
        onPrev={offset > 0 ? () => setOffset((o) => o - 1) : undefined}
        onNext={() => setOffset((o) => o + 1)}
        onMonth={() => setMonthOpen(true)}
      />
      <MonthDatePicker
        open={monthOpen}
        initialDate={value ? new Date(`${value}T12:00:00`) : new Date()}
        onClose={() => setMonthOpen(false)}
        onSelect={(date) => {
          pick(toISODate(date));
          setMonthOpen(false);
        }}
      />
    </View>
  );
}

/** The Time editor: named times, then the time wheel. '' is any time. */
export function TimeEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const picked = TIME_QUICK_CHOICES.find((c) => c.value === value)?.value ?? null;
  return (
    <View className="gap-3">
      <ChoiceChips
        options={TIME_QUICK_CHOICES.map((c) => ({ value: c.value, label: timeChoiceLabel(c) }))}
        value={picked}
        onChange={onChange}
        accessibilityLabel="Quick times"
      />
      <View className="rounded-xl bg-card py-1">
        <TimeScrollField value={value || '09:00'} onChange={onChange} />
      </View>
    </View>
  );
}

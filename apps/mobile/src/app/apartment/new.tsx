// HOUP-78: native port of apps/web/src/app/apartment/new/page.tsx — the
// add-apartment form (manual entry + AI auto-fill from a listing URL, pasted
// text, or uploaded photos). Layout follows the FormSection/FieldRow
// conventions already established for native item forms (see
// apps/mobile/src/features/setup/setup-item-sheet.tsx) inside a plain
// ScrollView page instead of a BottomSheet, since this is a standalone route
// (deep-linkable from the homesearch list), not a modal over other content.
//
// Two deliberate scoping simplifications vs. the web original, each already
// flagged on this ticket's plan:
//  1. PDF upload UI is dropped. The same /api/parse-listing backend already
//     extracts a realestate.com.au listing's PDF server-side when given the
//     listing URL (see route.ts's toReaPdfUrl branch), so URL-based autofill
//     covers that path transparently — there is no native-specific PDF
//     picker flow to build.
//  2. Agent linking reuses the native MultiAgentSelector the detail-screen
//     ticket in this same batch of work already built (apps/mobile/src/
//     features/settings/panels/multi-agent-selector.tsx — a chip list +
//     BottomSheet picker with inline "add new agent"), rather than
//     duplicating that logic here.
//
// Geocoding (HOUP-149): createApartmentFromParsed now best-effort geocodes
// via the authed GET /api/geocode proxy (apps/web/src/app/api/geocode/
// route.ts — the Mapbox token stays server-side there) and patches lat/lng +
// POI distances in, fire-and-forget, once patchApartment is passed in below.
//
// Hearth v2 pass (mirrors web): Back on its own row, a Display-step title
// with "Bulk upload" as its neutral outline action, "From a listing" then
// "Details" sections, plain destructive error text (no filled block), the
// parking checkbox fills with the accent (a toggle-on, not a success state),
// and a full-width "Save apartment" with Cancel beside it.
import * as React from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
// HOUP-318: keyboard-aware scroll container (same swap as Home/Costs) so an
// inline field low on the page scrolls above the on-screen keyboard.
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { AlertCircle, ArrowLeft, Check, ImagePlus, Sparkles } from 'lucide-react-native';
import { Text, Button, FieldRow, FormSection, Input, ScreenBackground, cn } from '@homeup/ui';
import { agents$, apartmentAgents$, apartments$, useReconnectSync, useStoreHelpers, type Agent } from '@homeup/core';
import { use$ } from '@legendapp/state/react';
import { useDataCache } from '@/lib/data-cache';
import { NoGroupScreen } from '@/components/no-group-screen';
import { MultiAgentSelector } from '@/features/settings/panels/multi-agent-selector';
import { createApartmentFromParsed, resolveParsedAgents } from '@/features/homesearch/create-apartment-from-parsed';
import { parseListing, type ParsedListing } from '@/features/homesearch/parse-listing-api';
import { takePendingShareImages } from '@/lib/share-ingest';
import { useOpenRoute } from '@/lib/tab-routes';

interface FormState {
  address: string;
  suburb: string;
  rent_per_week: string;
  bedrooms: string;
  bathrooms: string;
  parking: boolean;
  listing_url: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  address: '',
  suburb: '',
  rent_per_week: '',
  bedrooms: '',
  bathrooms: '',
  parking: false,
  listing_url: '',
  notes: '',
};

async function readAssetAsDataUrl(asset: ImagePicker.ImagePickerAsset): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
  const mime = asset.mimeType || 'image/jpeg';
  return `data:${mime};base64,${base64}`;
}

// HOUP-148: same read as readAssetAsDataUrl above, but for a raw file uri
// handed off from <ShareIntentHandler/> (a shared screenshot has no
// ImagePickerAsset.mimeType to read, so it's guessed from the extension).
async function readShareUriAsDataUrl(uri: string): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const ext = uri.split('.').pop()?.toLowerCase();
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${base64}`;
}

export default function NewApartmentScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const openRoute = useOpenRoute();
  const { listing_url: sharedListingUrl } = useLocalSearchParams<{ listing_url?: string }>();
  const { group, currentUserId, isOnline, loading: cacheLoading } = useDataCache();

  const agentsStore$ = agents$(group?.id);
  const apts$ = apartments$(group?.id);
  const apartmentAgentsStore$ = apartmentAgents$(group?.id);
  useReconnectSync(agentsStore$);
  useReconnectSync(apts$);
  useReconnectSync(apartmentAgentsStore$);
  const { writeRow: writeAgent } = useStoreHelpers(agentsStore$, currentUserId);
  const { writeRow: writeApartment, patchRow: patchApartment } = useStoreHelpers(apts$, currentUserId);
  const { writeRow: writeApartmentAgent } = useStoreHelpers(apartmentAgentsStore$, currentUserId);
  const agents = use$(() =>
    Object.values(agentsStore$.get() ?? {}).filter((a): a is Agent => !!a && !a.deleted)
  );

  const [form, setForm] = React.useState<FormState>(EMPTY_FORM);
  const [pastedText, setPastedText] = React.useState('');
  const [agentIds, setAgentIds] = React.useState<string[]>([]);
  const [parsedImageUrls, setParsedImageUrls] = React.useState<string[] | null>(null);
  const [autoParseTriggered, setAutoParseTriggered] = React.useState(false);
  // HOUP-148: drained once via a lazy initializer — a shared-image ingest
  // from <ShareIntentHandler/>, or null if this screen was reached normally.
  const [sharedImages, setSharedImages] = React.useState<string[] | null>(() => takePendingShareImages());

  const [parsing, setParsing] = React.useState(false);
  const [parseError, setParseError] = React.useState<string | null>(null);
  const [pickingPhotos, setPickingPhotos] = React.useState(false);
  const [pickError, setPickError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const applyParsed = (data: ParsedListing) => {
    setForm((f) => ({
      ...f,
      address: data.address || f.address,
      suburb: data.suburb || f.suburb,
      rent_per_week: data.rent_per_week != null ? String(data.rent_per_week) : f.rent_per_week,
      bedrooms: data.bedrooms != null ? String(data.bedrooms) : f.bedrooms,
      bathrooms: data.bathrooms != null ? String(data.bathrooms) : f.bathrooms,
      parking: data.parking ?? f.parking,
      notes: data.notes || f.notes,
    }));

    if (data.image_urls?.length) {
      setParsedImageUrls(data.image_urls);
    }

    const parsedAgents = data.agents?.length
      ? data.agents
      : data.agent_name
        ? [{ name: data.agent_name, phone: data.agent_phone }]
        : [];

    if (parsedAgents.length > 0 && group) {
      const resolvedIds = resolveParsedAgents(parsedAgents, agents, writeAgent, group.id, currentUserId);
      if (resolvedIds.length > 0) setAgentIds(resolvedIds);
    }
  };

  const handleAutofillFromText = async () => {
    if (!isOnline || parsing) return;
    const url = form.listing_url.trim();
    const text = pastedText.trim();
    if (!url && !text) return;

    setParsing(true);
    setParseError(null);
    try {
      const data = await parseListing({ url: url || undefined, text: text || undefined });
      applyParsed(data);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Network error: could not reach parser');
    } finally {
      setParsing(false);
    }
  };

  const handleAutofillFromPhotos = async () => {
    if (!isOnline || pickingPhotos) return;
    setPickError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setPickError('Photo library access is needed to autofill from screenshots.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsMultipleSelection: true,
    });
    if (result.canceled || !result.assets?.length) return;

    setPickingPhotos(true);
    setParseError(null);
    try {
      const images = await Promise.all(result.assets.map(readAssetAsDataUrl));
      const data = await parseListing({ images });
      applyParsed(data);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Network error: could not reach parser');
    } finally {
      setPickingPhotos(false);
    }
  };

  // HOUP-148: mirrors web apartment/new/page.tsx's autoParseTriggered effect
  // pair — seed listing_url from a shared-URL param, then fire the same
  // autofill the manual "Autofill" button uses, once online.
  React.useEffect(() => {
    if (sharedListingUrl && !autoParseTriggered) {
      setForm((f) => ({ ...f, listing_url: sharedListingUrl }));
      setAutoParseTriggered(true);
    }
  }, [sharedListingUrl, autoParseTriggered]);

  React.useEffect(() => {
    if (autoParseTriggered && form.listing_url && !parsing && isOnline) {
      handleAutofillFromText();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoParseTriggered, isOnline]);

  // HOUP-148: shared screenshot(s) ingest — same autofill-from-photos path
  // handleAutofillFromPhotos uses, just sourced from the share intent
  // instead of ImagePicker. Gated on isOnline (parseListing needs network)
  // and consumed exactly once (setSharedImages(null) before the async work
  // starts) so it never re-fires.
  React.useEffect(() => {
    if (!sharedImages?.length || !isOnline || pickingPhotos) return;
    const uris = sharedImages;
    setSharedImages(null);
    (async () => {
      setPickingPhotos(true);
      setParseError(null);
      try {
        const images = await Promise.all(uris.map(readShareUriAsDataUrl));
        const data = await parseListing({ images });
        applyParsed(data);
      } catch (err) {
        setParseError(err instanceof Error ? err.message : 'Network error: could not reach parser');
      } finally {
        setPickingPhotos(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedImages, isOnline]);

  const canSubmit = form.address.trim().length > 0 && !!group && !saving;

  const handleSubmit = async () => {
    if (!canSubmit || !group) return;
    setSaving(true);
    try {
      const apartmentId = await createApartmentFromParsed({
        groupId: group.id,
        currentUserId,
        address: form.address.trim(),
        suburb: form.suburb.trim() || null,
        rentPerWeek: form.rent_per_week ? Number(form.rent_per_week) : null,
        bedrooms: form.bedrooms ? Number(form.bedrooms) : null,
        bathrooms: form.bathrooms ? Number(form.bathrooms) : null,
        parking: form.parking,
        listingUrl: form.listing_url.trim() || null,
        notes: form.notes.trim() || null,
        agentIds,
        imageUrls: parsedImageUrls ?? [],
        writeApartment,
        writeApartmentAgent,
        patchApartment,
      });
      router.push(`/apartment/${apartmentId}` as Href);
    } finally {
      setSaving(false);
    }
  };

  if (cacheLoading) {
    return (
      <ScreenBackground className="items-center justify-center">
        <ActivityIndicator />
      </ScreenBackground>
    );
  }

  if (!group) {
    return <NoGroupScreen />;
  }

  return (
    <ScreenBackground>
    <KeyboardAwareScrollView
      className="flex-1"
      contentContainerClassName="gap-4 p-4"
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 96 }}
      keyboardShouldPersistTaps="handled"
    >
      <Pressable
        onPress={() => router.back()}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Back"
        className="-ml-1 min-h-[44px] flex-row items-center gap-1 self-start px-1"
      >
        <ArrowLeft size={16} className="text-muted-foreground" />
        <Text className="text-sm text-muted-foreground">Back</Text>
      </Pressable>

      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-display text-foreground">Add apartment</Text>
        <Button variant="outline" size="sm" className="border-border/60" onPress={() => router.push('/apartment/bulk' as Href)}>
          Bulk upload
        </Button>
      </View>

      <FormSection title="From a listing">
        <FieldRow label="Listing URL">
          <Input
            value={form.listing_url}
            onChangeText={(listing_url) => setForm((f) => ({ ...f, listing_url }))}
            placeholder="https://..."
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
        </FieldRow>

        <FieldRow label="Paste listing text">
          <TextInput
            value={pastedText}
            onChangeText={setPastedText}
            placeholder="Paste the listing description"
            multiline
            numberOfLines={4}
            className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-body text-foreground placeholder:text-muted-foreground"
          />
        </FieldRow>

        <View className="flex-row flex-wrap gap-2">
          <Button
            variant="outline"
            className="h-11"
            onPress={handleAutofillFromText}
            disabled={parsing || pickingPhotos || !isOnline || (!form.listing_url.trim() && !pastedText.trim())}
          >
            {parsing ? <ActivityIndicator size="small" /> : <Sparkles size={16} className="text-muted-foreground" />}
            <Text className="text-sm font-medium text-foreground">{parsing ? 'Reading listing' : 'Auto-fill'}</Text>
          </Button>
          <Button variant="outline" className="h-11" onPress={handleAutofillFromPhotos} disabled={parsing || pickingPhotos || !isOnline}>
            {pickingPhotos ? <ActivityIndicator size="small" /> : <ImagePlus size={16} className="text-muted-foreground" />}
            <Text className="text-sm font-medium text-foreground">{pickingPhotos ? 'Reading photos' : 'From screenshots'}</Text>
          </Button>
        </View>

        {!isOnline && <Text className="text-xs text-muted-foreground">You&apos;re offline. Reconnect to use AI autofill.</Text>}

        {(parseError || pickError) && (
          <View className="flex-row items-center gap-1.5">
            <AlertCircle size={14} className="shrink-0 text-destructive" />
            <Text className="flex-1 text-sm text-destructive">{parseError || pickError}</Text>
          </View>
        )}

        {parsedImageUrls && parsedImageUrls.length > 0 && (
          <Text className="text-xs text-muted-foreground">
            {parsedImageUrls.length} listing image{parsedImageUrls.length !== 1 ? 's' : ''} found, saved with the apartment
          </Text>
        )}
      </FormSection>

      <FormSection title="Details">
        <FieldRow label="Address" required>
          <Input
            value={form.address}
            onChangeText={(address) => setForm((f) => ({ ...f, address }))}
            placeholder="123 Main St"
          />
        </FieldRow>

        <FieldRow label="Suburb">
          <Input value={form.suburb} onChangeText={(suburb) => setForm((f) => ({ ...f, suburb }))} placeholder="e.g. Bondi" />
        </FieldRow>

        <View className="flex-row gap-3">
          <FieldRow label="Rent /wk" className="flex-1">
            <Input
              value={form.rent_per_week}
              onChangeText={(rent_per_week) => setForm((f) => ({ ...f, rent_per_week }))}
              placeholder="500"
              keyboardType="decimal-pad"
            />
          </FieldRow>
          <FieldRow label="Bedrooms" className="flex-1">
            <Input
              value={form.bedrooms}
              onChangeText={(bedrooms) => setForm((f) => ({ ...f, bedrooms }))}
              placeholder="2"
              keyboardType="decimal-pad"
            />
          </FieldRow>
          <FieldRow label="Bathrooms" className="flex-1">
            <Input
              value={form.bathrooms}
              onChangeText={(bathrooms) => setForm((f) => ({ ...f, bathrooms }))}
              placeholder="1"
              keyboardType="decimal-pad"
            />
          </FieldRow>
        </View>

        <Pressable
          onPress={() => setForm((f) => ({ ...f, parking: !f.parking }))}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: form.parking }}
          className="min-h-[44px] flex-row items-center gap-2.5"
        >
          <View className={cn('h-5 w-5 items-center justify-center rounded border', form.parking ? 'border-primary bg-primary' : 'border-border')}>
            {form.parking && <Check size={12} className="text-primary-foreground" />}
          </View>
          <Text className="text-sm font-medium text-foreground">Has parking</Text>
        </Pressable>

        <FieldRow label="Notes">
          <TextInput
            value={form.notes}
            onChangeText={(notes) => setForm((f) => ({ ...f, notes }))}
            placeholder="Any notes about this place"
            multiline
            numberOfLines={3}
            className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-body text-foreground placeholder:text-muted-foreground"
          />
        </FieldRow>
      </FormSection>

      <FormSection title="Agents">
        <MultiAgentSelector value={agentIds} onChange={setAgentIds} />
      </FormSection>

      <View className="flex-row gap-3 pt-2">
        <Button className="h-11 flex-1" onPress={handleSubmit} disabled={!canSubmit}>
          <Text className="text-sm font-medium text-primary-foreground">{saving ? 'Saving' : 'Save apartment'}</Text>
        </Button>
        <Button variant="outline" className="h-11" onPress={() => openRoute('/homesearch')} disabled={saving}>
          <Text className="text-sm font-medium text-foreground">Cancel</Text>
        </Button>
      </View>
    </KeyboardAwareScrollView>
    </ScreenBackground>
  );
}

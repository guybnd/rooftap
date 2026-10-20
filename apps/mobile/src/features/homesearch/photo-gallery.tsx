// HOUP-78: native port of apps/web/src/components/photo-gallery.tsx. Camera/
// library picking uses expo-image-picker (works on Expo-web too, so this one
// file needs no .web.tsx split) in place of web's hidden <input type="file">
// pair; the same Supabase storage("apartment-photos")/table("photos") upload
// shape is mirrored via a base64-read -> ArrayBuffer decode (the same robust
// upload path already used by apps/mobile/src/components/documents/
// capture-flow.tsx) instead of a raw fetch-to-Blob, which is historically
// flaky on RN. Client-side compression (`browser-image-compression`) is a
// DOM-only library and is deliberately dropped — the picker's own `quality`
// option is used instead, and RN-picked images are already reasonably
// sized. The full-screen lightbox uses RN `Modal` + a swipeable, paging
// `FlatList` instead of `document`-level keydown listeners (web-only) for
// prev/next navigation; Android hardware-back closes it via
// `onRequestClose`. Web's native <select> for room re-tagging inside the
// lightbox becomes a horizontally scrollable row of tap-to-toggle chips
// (same chip idiom as the pre-upload room picker below) — there is no RN
// equivalent of <select>. Busy/uploading state renders via `ActivityIndicator`
// rather than a spinning Loader2 icon, matching the idiom already used by
// apps/mobile/src/components/documents/capture-flow.tsx (NativeWind has no
// direct `animate-spin` equivalent in this codebase).
//
// Hearth v2 pass (mirrors web): Title-step heading with a muted count, icon
// buttons at 36px, one grid ordered by room with the room as a caption on
// the photo (no header per room), neutral main-photo mark, plain destructive
// error text (never a filled block), and a neutral empty card.
import * as React from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { AlertCircle, Camera, ChevronLeft, ChevronRight, ImagePlus, Star, Trash2, X } from 'lucide-react-native';
import { Button, cn, haptics } from '@homeup/ui';
import {
  ROOM_OPTIONS,
  deleteApartmentPhoto,
  listApartmentPhotos,
  setMainApartmentPhoto,
  updateApartmentPhotoRoom,
  uploadApartmentPhoto,
  type Photo,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { randomUUID } from '@/lib/uuid';

export interface PhotoGalleryProps {
  apartmentId: string;
}


function extensionFor(asset: ImagePicker.ImagePickerAsset): string {
  const fromName = asset.fileName?.split('.').pop();
  if (fromName && fromName.length <= 5) return fromName.toLowerCase();
  const sub = asset.mimeType?.split('/')[1];
  if (sub) return sub === 'jpeg' ? 'jpg' : sub.toLowerCase();
  return 'jpg';
}

async function readAssetBody(uri: string): Promise<ArrayBuffer> {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  return decode(base64);
}

export function PhotoGallery({ apartmentId }: PhotoGalleryProps) {
  const { isOnline } = useDataCache();
  const [photos, setPhotos] = React.useState<Photo[]>([]);
  const [photoUrls, setPhotoUrls] = React.useState<Record<string, string>>({});
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [pickError, setPickError] = React.useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = React.useState<number | null>(null);
  const [pendingAssets, setPendingAssets] = React.useState<ImagePicker.ImagePickerAsset[]>([]);
  const [selectedRoom, setSelectedRoom] = React.useState('');
  const [showRoomPicker, setShowRoomPicker] = React.useState(false);

  const fetchPhotos = React.useCallback(async () => {
    const result = await listApartmentPhotos(getCurrentSupabaseClient(), apartmentId);
    if (result) {
      setPhotos(result.photos);
      setPhotoUrls(result.urls);
    }
  }, [apartmentId]);

  React.useEffect(() => {
    void fetchPhotos();
  }, [fetchPhotos]);

  const pickFromCamera = React.useCallback(async () => {
    setPickError(null);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setPickError('Camera access is needed to take a photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled || !result.assets?.length) return;
    setPendingAssets(result.assets);
    setShowRoomPicker(true);
  }, []);

  const pickFromLibrary = React.useCallback(async () => {
    setPickError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setPickError('Photo library access is needed to choose photos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsMultipleSelection: true,
    });
    if (result.canceled || !result.assets?.length) return;
    setPendingAssets(result.assets);
    setShowRoomPicker(true);
  }, []);

  const cancelPending = React.useCallback(() => {
    setPendingAssets([]);
    setSelectedRoom('');
    setShowRoomPicker(false);
  }, []);

  const uploadPending = React.useCallback(async () => {
    if (!isOnline || pendingAssets.length === 0 || uploading) return;
    setUploading(true);
    setUploadError(null);
    const supabase = getCurrentSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setUploading(false);
      return;
    }

    const isFirst = photos.length === 0;
    let failedCount = 0;

    for (let i = 0; i < pendingAssets.length; i++) {
      const asset = pendingAssets[i];
      try {
        const body = await readAssetBody(asset.uri);
        const ext = extensionFor(asset);
        const uploaded = await uploadApartmentPhoto(supabase, {
          userId: user.id,
          apartmentId,
          filename: `${randomUUID()}.${ext}`,
          body,
          contentType: asset.mimeType ?? `image/${ext}`,
          room: selectedRoom,
          isMain: isFirst && i === 0,
        });
        if (!uploaded) failedCount++;
      } catch {
        failedCount++;
      }
    }

    if (failedCount > 0) {
      setUploadError(`${failedCount} photo${failedCount > 1 ? 's' : ''} failed to upload.`);
    } else {
      haptics.success();
    }

    setUploading(false);
    cancelPending();
    void fetchPhotos();
  }, [apartmentId, fetchPhotos, photos.length, isOnline, pendingAssets, selectedRoom, uploading, cancelPending]);

  const handleDelete = React.useCallback(
    async (photo: Photo) => {
      const prev = photos;
      setPhotos((p) => p.filter((x) => x.id !== photo.id));

      const deleted = await deleteApartmentPhoto(getCurrentSupabaseClient(), photo);
      if (!deleted) {
        setPhotos(prev);
      } else {
        haptics.tick();
        setLightboxIndex(null);
      }
    },
    [photos]
  );

  const setAsMain = React.useCallback(
    async (photo: Photo) => {
      const previousMain = photos.find((p) => p.is_main);
      if (await setMainApartmentPhoto(getCurrentSupabaseClient(), apartmentId, photo, previousMain)) {
        haptics.tick();
      }
      void fetchPhotos();
    },
    [apartmentId, photos, fetchPhotos]
  );

  const updateRoom = React.useCallback(
    async (photo: Photo, room: string) => {
      await updateApartmentPhotoRoom(getCurrentSupabaseClient(), photo.id, room);
      void fetchPhotos();
    },
    [fetchPhotos]
  );

  const openLightbox = (index: number) => setLightboxIndex(index);
  const closeLightbox = () => setLightboxIndex(null);

  const groupedByRoom = photos.reduce<Record<string, Photo[]>>((acc, photo) => {
    const key = photo.room || 'Untagged';
    if (!acc[key]) acc[key] = [];
    acc[key].push(photo);
    return acc;
  }, {});

  const hasMultipleRooms =
    Object.keys(groupedByRoom).length > 1 ||
    (Object.keys(groupedByRoom).length === 1 && !groupedByRoom['Untagged']);

  const renderThumb = (photo: Photo) => {
    const index = photos.indexOf(photo);
    return (
      <Pressable
        key={photo.id}
        onPress={() => openLightbox(index)}
        accessibilityRole="imagebutton"
        accessibilityLabel={photo.room ? `${photo.room} photo` : 'Apartment photo'}
        className="relative aspect-square w-[31.5%] overflow-hidden rounded-2xl bg-muted"
      >
        {photoUrls[photo.id] && (
          <Image
            source={{ uri: photoUrls[photo.id] }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            accessibilityLabel={photo.room || 'Apartment photo'}
          />
        )}
        {photo.is_main && (
          <View className="absolute left-1.5 top-1.5 rounded-full bg-black/55 p-1">
            <Star size={12} className="fill-current text-white" />
          </View>
        )}
        {hasMultipleRooms && (
          <View className="absolute inset-x-0 bottom-0 bg-black/50 px-2 py-1">
            <Text numberOfLines={1} className="text-xs font-medium text-white">
              {photo.room || 'Untagged'}
            </Text>
          </View>
        )}
      </Pressable>
    );
  };

  const orderedPhotos = hasMultipleRooms ? Object.values(groupedByRoom).flat() : photos;

  return (
    <View>
      <View className="mb-3 flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <Camera size={16} className="text-muted-foreground" />
          <Text className="text-title text-foreground">Photos</Text>
          {photos.length > 0 && (
            <Text className="text-sm text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
              {photos.length}
            </Text>
          )}
        </View>
        <View className="flex-row items-center gap-2">
          <Button
            size="icon-lg"
            variant="outline"
            onPress={() => void pickFromCamera()}
            disabled={uploading || !isOnline}
            accessibilityLabel="Take a photo"
          >
            <Camera size={16} className="text-muted-foreground" />
          </Button>
          <Button
            size="icon-lg"
            variant="outline"
            onPress={() => void pickFromLibrary()}
            disabled={uploading || !isOnline}
            accessibilityLabel={uploading ? 'Uploading' : 'Upload photos'}
          >
            {uploading ? <ActivityIndicator size="small" /> : <ImagePlus size={16} className="text-muted-foreground" />}
          </Button>
        </View>
      </View>

      {!isOnline && <Text className="mb-3 text-xs text-muted-foreground">You&apos;re offline. Reconnect to add photos.</Text>}

      {pickError && (
        <View className="mb-3 flex-row items-center gap-1.5">
          <AlertCircle size={14} className="shrink-0 text-destructive" />
          <Text className="flex-1 text-sm text-destructive">{pickError}</Text>
        </View>
      )}

      {showRoomPicker && (
        <View className="mb-4 rounded-3xl border border-border/60 bg-card p-4">
          <Text className="mb-3 text-body font-medium text-foreground">
            Tag {pendingAssets.length} photo{pendingAssets.length > 1 ? 's' : ''} with a room
          </Text>
          <View className="mb-3 flex-row flex-wrap gap-2">
            {ROOM_OPTIONS.map((room) => (
              <Pressable
                key={room}
                onPress={() => setSelectedRoom((r) => (r === room ? '' : room))}
                accessibilityRole="button"
                accessibilityState={{ selected: selectedRoom === room }}
                className={cn(
                  'h-9 justify-center rounded-lg border px-3',
                  selectedRoom === room ? 'border-primary/40 bg-primary/10' : 'border-transparent bg-muted/50'
                )}
              >
                <Text
                  className={cn(
                    'text-xs font-medium',
                    selectedRoom === room ? 'text-primary' : 'text-muted-foreground'
                  )}
                >
                  {room}
                </Text>
              </Pressable>
            ))}
          </View>
          <View className="flex-row gap-2">
            <Button size="sm" onPress={() => void uploadPending()} disabled={uploading}>
              {uploading && <ActivityIndicator size="small" color="white" />}
              <Text className="text-sm font-medium text-primary-foreground">
                {selectedRoom ? `Upload as ${selectedRoom}` : 'Upload untagged'}
              </Text>
            </Button>
            <Button size="sm" variant="ghost" onPress={cancelPending} disabled={uploading}>
              <Text className="text-sm font-medium text-foreground">Cancel</Text>
            </Button>
          </View>
        </View>
      )}

      {uploadError && (
        <View className="mb-3 flex-row items-center gap-1.5">
          <AlertCircle size={14} className="shrink-0 text-destructive" />
          <Text className="flex-1 text-sm text-destructive">{uploadError}</Text>
        </View>
      )}

      {photos.length === 0 && !showRoomPicker ? (
        <Pressable
          onPress={() => isOnline && void pickFromCamera()}
          disabled={!isOnline}
          accessibilityRole="button"
          className={cn(
            'items-center rounded-3xl border border-border/60 bg-card px-6 py-8',
            !isOnline && 'opacity-60'
          )}
        >
          <View className="mb-3 rounded-2xl bg-muted/60 p-4">
            <Camera size={24} className="text-muted-foreground" />
          </View>
          <Text className="text-sm font-medium text-foreground">No photos yet</Text>
          {isOnline && <Text className="mt-0.5 text-xs text-muted-foreground">Tap to take the first one</Text>}
        </Pressable>
      ) : (
        <View className="flex-row flex-wrap gap-2">{orderedPhotos.map(renderThumb)}</View>
      )}

      {lightboxIndex !== null && photos[lightboxIndex] && (
        <Lightbox
          photos={photos}
          photoUrls={photoUrls}
          initialIndex={lightboxIndex}
          onClose={closeLightbox}
          onSetMain={setAsMain}
          onUpdateRoom={updateRoom}
          onDelete={handleDelete}
        />
      )}
    </View>
  );
}

interface LightboxProps {
  photos: Photo[];
  photoUrls: Record<string, string>;
  initialIndex: number;
  onClose: () => void;
  onSetMain: (photo: Photo) => void;
  onUpdateRoom: (photo: Photo, room: string) => void;
  onDelete: (photo: Photo) => void;
}

function Lightbox({ photos, photoUrls, initialIndex, onClose, onSetMain, onUpdateRoom, onDelete }: LightboxProps) {
  const [index, setIndex] = React.useState(initialIndex);
  const listRef = React.useRef<FlatList<Photo>>(null);
  const screenWidth = Dimensions.get('window').width;

  const navigate = React.useCallback(
    (direction: -1 | 1) => {
      const next = index + direction;
      if (next < 0 || next >= photos.length) return;
      listRef.current?.scrollToIndex({ index: next, animated: true });
      setIndex(next);
    },
    [index, photos.length]
  );

  const onMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
    setIndex(Math.max(0, Math.min(next, photos.length - 1)));
  };

  const photo = photos[index];
  if (!photo) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View className="flex-1 bg-black/95">
        <Pressable
          onPress={onClose}
          hitSlop={8}
          accessibilityLabel="Close lightbox"
          className="absolute right-3 top-3 z-10 h-11 w-11 items-center justify-center rounded-full bg-white/10"
        >
          <X size={22} className="text-white" />
        </Pressable>

        {/* Full-height row so the nav buttons center vertically via flexbox
            (avoids relying on percentage-based transforms, which RN does
            not support) without stealing touches from the swipe area. */}
        <View pointerEvents="box-none" className="absolute inset-0 z-10 flex-row items-center justify-between px-2">
          {index > 0 ? (
            <Pressable
              onPress={() => navigate(-1)}
              accessibilityLabel="Previous photo"
              className="h-11 w-11 items-center justify-center rounded-full bg-white/10"
            >
              <ChevronLeft size={22} className="text-white" />
            </Pressable>
          ) : (
            <View className="h-11 w-11" />
          )}
          {index < photos.length - 1 ? (
            <Pressable
              onPress={() => navigate(1)}
              accessibilityLabel="Next photo"
              className="h-11 w-11 items-center justify-center rounded-full bg-white/10"
            >
              <ChevronRight size={22} className="text-white" />
            </Pressable>
          ) : (
            <View className="h-11 w-11" />
          )}
        </View>

        <FlatList
          ref={listRef}
          data={photos}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(p) => p.id}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, i) => ({ length: screenWidth, offset: screenWidth * i, index: i })}
          onMomentumScrollEnd={onMomentumScrollEnd}
          renderItem={({ item }) => (
            <View style={{ width: screenWidth }} className="flex-1 items-center justify-center px-4">
              {photoUrls[item.id] && (
                <Image
                  source={{ uri: photoUrls[item.id] }}
                  style={{ width: '100%', height: '70%' }}
                  contentFit="contain"
                  accessibilityLabel={item.room || 'Apartment photo'}
                />
              )}
            </View>
          )}
        />

        <View className="gap-3 px-4 pb-8 pt-4">
          <View className="flex-row flex-wrap items-center justify-center gap-2">
            <Text className="text-sm font-medium text-white/80" style={{ fontVariant: ['tabular-nums'] }}>
              {index + 1} / {photos.length}
            </Text>
            <Pressable
              onPress={() => onSetMain(photo)}
              accessibilityLabel={photo.is_main ? 'Main photo' : 'Set as main photo'}
              className={cn(
                'h-9 w-9 items-center justify-center rounded-full',
                photo.is_main ? 'bg-white/20' : 'bg-white/10'
              )}
            >
              <Star size={16} className={photo.is_main ? 'fill-current text-white' : 'text-white/70'} />
            </Pressable>
            <Pressable
              onPress={() => onDelete(photo)}
              accessibilityLabel="Delete photo"
              className="h-9 w-9 items-center justify-center rounded-full bg-white/10"
            >
              <Trash2 size={16} className="text-white/70" />
            </Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-1.5 self-center px-1">
            <Pressable
              onPress={() => onUpdateRoom(photo, '')}
              className={cn('rounded-full px-2.5 py-1', !photo.room ? 'bg-white/25' : 'bg-white/10')}
            >
              <Text className="text-xs text-white/80">No room</Text>
            </Pressable>
            {ROOM_OPTIONS.map((room) => (
              <Pressable
                key={room}
                onPress={() => onUpdateRoom(photo, room)}
                className={cn('rounded-full px-2.5 py-1', photo.room === room ? 'bg-white/25' : 'bg-white/10')}
              >
                <Text className="text-xs text-white/80">{room}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

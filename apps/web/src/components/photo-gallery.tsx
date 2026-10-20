"use client";

import { useState, useEffect, useCallback, useRef, type TouchEvent as ReactTouchEvent } from "react";
import { Camera, ImagePlus, Trash2, X, ChevronLeft, ChevronRight, Loader2, Star, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { useDataCache } from "@/lib/data-cache";
import { OfflineHint } from "@/components/offline-hint";
import { cn } from "@/lib/utils";
import imageCompression from "browser-image-compression";
import type { Photo } from '@homeup/core';
import {
  ROOM_OPTIONS,
  deleteApartmentPhoto,
  listApartmentPhotos,
  setMainApartmentPhoto,
  updateApartmentPhotoRoom,
  uploadApartmentPhoto,
} from '@homeup/core';

interface PhotoGalleryProps {
  apartmentId: string;
}

const COMPRESSION_OPTIONS = {
  maxSizeMB: 1,
  maxWidthOrHeight: 1920,
  useWebWorker: true,
};

export function PhotoGallery({ apartmentId }: PhotoGalleryProps) {
  const { isOnline } = useDataCache();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<string>("");
  const [showRoomPicker, setShowRoomPicker] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const fetchPhotos = useCallback(async () => {
    const result = await listApartmentPhotos(createClient(), apartmentId);
    if (result) {
      setPhotos(result.photos);
      setPhotoUrls(result.urls);
    }
  }, [apartmentId]);

  useEffect(() => {
    fetchPhotos();
  }, [fetchPhotos]);

  const uploadFiles = useCallback(async (files: File[], room: string) => {
    if (!isOnline) return;
    setUploading(true);
    setUploadError(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setUploading(false);
      return;
    }

    const isFirst = photos.length === 0;
    let failedCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith("image/")) continue;

      const compressed = await imageCompression(file, COMPRESSION_OPTIONS);
      const ext = file.name.split(".").pop() || "jpg";
      const uploaded = await uploadApartmentPhoto(supabase, {
        userId: user.id,
        apartmentId,
        filename: `${crypto.randomUUID()}.${ext}`,
        body: compressed,
        contentType: compressed.type,
        room,
        isMain: isFirst && i === 0,
      });
      if (!uploaded) failedCount++;
    }

    if (failedCount > 0) {
      setUploadError(`${failedCount} photo${failedCount > 1 ? "s" : ""} failed to upload.`);
    }

    setUploading(false);
    setPendingFiles([]);
    setSelectedRoom("");
    setShowRoomPicker(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    fetchPhotos();
  }, [apartmentId, fetchPhotos, photos.length, isOnline]);

  const handleFilesSelected = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const fileArray = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (fileArray.length === 0) return;
    setPendingFiles(fileArray);
    setShowRoomPicker(true);
  };

  const handleRoomConfirm = () => {
    uploadFiles(pendingFiles, selectedRoom);
  };

  const handleDelete = useCallback(async (photo: Photo) => {
    const prev = photos;
    setPhotos((p) => p.filter((x) => x.id !== photo.id));

    const deleted = await deleteApartmentPhoto(createClient(), photo);
    if (!deleted) setPhotos(prev);
    else setLightboxIndex(null);
  }, [photos]);

  const setAsMain = useCallback(async (photo: Photo) => {
    const previousMain = photos.find((p) => p.is_main);
    await setMainApartmentPhoto(createClient(), apartmentId, photo, previousMain);
    fetchPhotos();
  }, [apartmentId, photos, fetchPhotos]);

  const updateRoom = useCallback(async (photo: Photo, room: string) => {
    await updateApartmentPhotoRoom(createClient(), photo.id, room);
    fetchPhotos();
  }, [fetchPhotos]);

  const openLightbox = (index: number) => setLightboxIndex(index);
  const closeLightbox = () => setLightboxIndex(null);

  const navigateLightbox = (direction: -1 | 1) => {
    if (lightboxIndex === null) return;
    const next = lightboxIndex + direction;
    if (next >= 0 && next < photos.length) setLightboxIndex(next);
  };

  const groupedByRoom = photos.reduce<Record<string, Photo[]>>((acc, photo) => {
    const key = photo.room || "Untagged";
    if (!acc[key]) acc[key] = [];
    acc[key].push(photo);
    return acc;
  }, {});

  const hasMultipleRooms = Object.keys(groupedByRoom).length > 1 ||
    (Object.keys(groupedByRoom).length === 1 && !groupedByRoom["Untagged"]);

  // Hearth v2 pass: Title-step heading with a muted count; one grid ordered by
  // room with the room as a caption on the photo (rooms no longer stack one
  // header per photo); the main-photo mark and captions are neutral scrims.
  const orderedPhotos = hasMultipleRooms ? Object.values(groupedByRoom).flat() : photos;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-heading text-base font-semibold">
          <Camera className="h-4 w-4 text-muted-foreground" />
          Photos
          {photos.length > 0 && (
            <span className="font-sans text-sm font-normal tabular-nums text-muted-foreground">
              {photos.length}
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          {!isOnline && <OfflineHint />}
          <Button
            variant="outline"
            className="h-9 min-w-9 rounded-lg px-2.5"
            onClick={() => cameraInputRef.current?.click()}
            disabled={uploading || !isOnline}
            aria-label="Take a photo"
          >
            <Camera className="h-4 w-4 text-muted-foreground" />
            <span className="ml-1.5 hidden sm:inline">Camera</span>
          </Button>
          <Button
            variant="outline"
            className="h-9 min-w-9 rounded-lg px-2.5"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || !isOnline}
            aria-label="Upload photos"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <ImagePlus className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="ml-1.5 hidden sm:inline">{uploading ? "Uploading" : "Upload"}</span>
          </Button>
        </div>
      </div>

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFilesSelected(e.target.files)}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handleFilesSelected(e.target.files)}
      />

      {showRoomPicker && (
        <div className="mb-4 rounded-3xl border border-border/60 bg-card p-4 shadow-[var(--card-shadow)]">
          <p className="mb-3 text-sm font-medium">
            Tag {pendingFiles.length} photo{pendingFiles.length > 1 ? "s" : ""} with a room
          </p>
          <div className="mb-3 flex flex-wrap gap-2">
            {ROOM_OPTIONS.map((room) => (
              <button
                key={room}
                onClick={() => setSelectedRoom(selectedRoom === room ? "" : room)}
                aria-pressed={selectedRoom === room}
                className={cn(
                  "h-9 rounded-lg px-3 text-xs font-medium transition-colors",
                  selectedRoom === room
                    ? "bg-primary/10 text-primary ring-1 ring-inset ring-primary/40"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted"
                )}
              >
                {room}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button className="h-10 rounded-xl px-3.5" onClick={handleRoomConfirm} disabled={uploading}>
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : null}
              {selectedRoom ? `Upload as ${selectedRoom}` : "Upload untagged"}
            </Button>
            <Button
              variant="ghost"
              className="h-10 rounded-xl px-3.5"
              onClick={() => { setPendingFiles([]); setShowRoomPicker(false); setSelectedRoom(""); }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {uploadError && (
        <p className="mb-3 flex items-center gap-1.5 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {uploadError}
        </p>
      )}

      {photos.length === 0 && !showRoomPicker ? (
        <button
          type="button"
          disabled={!isOnline}
          className={cn(
            "flex w-full flex-col items-center rounded-3xl border border-border/60 bg-card px-6 py-8 text-center shadow-[var(--card-shadow)] transition-colors",
            isOnline ? "hover:border-primary/30" : "cursor-not-allowed opacity-60"
          )}
          onClick={() => isOnline && cameraInputRef.current?.click()}
        >
          <span className="mb-3 rounded-2xl bg-muted/60 p-4">
            <Camera className="h-6 w-6 text-muted-foreground" />
          </span>
          <span className="text-sm font-medium">No photos yet</span>
          {isOnline ? (
            <span className="mt-0.5 text-xs text-muted-foreground">Tap to take the first one</span>
          ) : (
            <OfflineHint className="mt-1.5 justify-center" />
          )}
        </button>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {orderedPhotos.map((photo) => {
            const globalIndex = photos.indexOf(photo);
            return (
              <button
                key={photo.id}
                onClick={() => openLightbox(globalIndex)}
                className="group relative aspect-square overflow-hidden rounded-2xl bg-muted"
                aria-label={photo.room ? `${photo.room} photo` : "Apartment photo"}
              >
                {photoUrls[photo.id] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photoUrls[photo.id]}
                    alt={photo.room || "Apartment photo"}
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  />
                )}
                {photo.is_main && (
                  <span className="absolute left-1.5 top-1.5 rounded-full bg-black/55 p-1 text-white backdrop-blur-sm" aria-label="Main photo">
                    <Star className="h-3 w-3 fill-current" />
                  </span>
                )}
                {hasMultipleRooms && (
                  <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/65 to-transparent px-2 pb-1.5 pt-5 text-left text-xs font-medium text-white">
                    {photo.room || "Untagged"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {lightboxIndex !== null && photos[lightboxIndex] && (
        <Lightbox
          photos={photos}
          photoUrls={photoUrls}
          currentIndex={lightboxIndex}
          onClose={closeLightbox}
          onNavigate={navigateLightbox}
          onSetMain={setAsMain}
          onUpdateRoom={updateRoom}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}

interface LightboxProps {
  photos: Photo[];
  photoUrls: Record<string, string>;
  currentIndex: number;
  onClose: () => void;
  onNavigate: (direction: -1 | 1) => void;
  onSetMain: (photo: Photo) => void;
  onUpdateRoom: (photo: Photo, room: string) => void;
  onDelete: (photo: Photo) => void;
}

function Lightbox({ photos, photoUrls, currentIndex, onClose, onNavigate, onSetMain, onUpdateRoom, onDelete }: LightboxProps) {
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && currentIndex > 0) onNavigate(-1);
      else if (e.key === "ArrowRight" && currentIndex < photos.length - 1) onNavigate(1);
    };
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [onClose, onNavigate, currentIndex, photos.length]);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  const handleTouchStart = (e: ReactTouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: ReactTouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const deltaX = e.changedTouches[0].clientX - touchStartX.current;
    const deltaY = e.changedTouches[0].clientY - touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;

    if (Math.abs(deltaX) < 50 || Math.abs(deltaY) > Math.abs(deltaX)) return;

    if (deltaX > 0 && currentIndex > 0) onNavigate(-1);
    else if (deltaX < 0 && currentIndex < photos.length - 1) onNavigate(1);
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const photo = photos[currentIndex];

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center"
      onClick={handleBackdropClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      tabIndex={-1}
      role="dialog"
      aria-label={`Photo ${currentIndex + 1} of ${photos.length}`}
      aria-modal="true"
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-3 right-3 z-10 h-11 w-11 rounded-full bg-white/10 text-white flex items-center justify-center active:bg-white/20 transition-colors"
        aria-label="Close lightbox"
      >
        <X className="h-6 w-6" />
      </button>

      {/* Navigation buttons */}
      {currentIndex > 0 && (
        <button
          onClick={() => onNavigate(-1)}
          className="absolute left-2 top-1/2 -translate-y-1/2 z-10 h-11 w-11 rounded-full bg-white/10 text-white flex items-center justify-center active:bg-white/20 transition-colors"
          aria-label="Previous photo"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      )}

      {currentIndex < photos.length - 1 && (
        <button
          onClick={() => onNavigate(1)}
          className="absolute right-2 top-1/2 -translate-y-1/2 z-10 h-11 w-11 rounded-full bg-white/10 text-white flex items-center justify-center active:bg-white/20 transition-colors"
          aria-label="Next photo"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      )}

      {/* Image */}
      <div className="max-w-[92vw] max-h-[70vh] sm:max-h-[78vh] relative flex items-center justify-center">
        {photoUrls[photo.id] && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrls[photo.id]}
            alt={photo.room || "Apartment photo"}
            className="max-w-full max-h-[70vh] sm:max-h-[78vh] object-contain select-none"
            draggable={false}
          />
        )}
      </div>

      {/* Bottom toolbar */}
      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent pt-10 pb-6 px-4">
        <div className="flex items-center justify-center gap-4 flex-wrap max-w-md mx-auto">
          {photo.room && (
            <span className="text-white/80 text-xs bg-white/10 px-2.5 py-1 rounded-full">
              {photo.room}
            </span>
          )}
          <span className="text-white/80 text-sm font-medium tabular-nums">
            {currentIndex + 1} / {photos.length}
          </span>
          <button
            onClick={() => onSetMain(photo)}
            className={`h-10 w-10 rounded-full flex items-center justify-center transition-colors ${
              photo.is_main
                ? "bg-white/20 text-white"
                : "bg-white/10 text-white/70 active:text-white"
            }`}
            aria-label={photo.is_main ? "Main photo" : "Set as main photo"}
          >
            <Star className={`h-5 w-5 ${photo.is_main ? "fill-current" : ""}`} />
          </button>
          <select
            value={photo.room || ""}
            onChange={(e) => onUpdateRoom(photo, e.target.value)}
            className="text-sm bg-white/10 text-white/80 border-0 rounded-lg px-3 py-2 outline-none min-h-[40px]"
          >
            <option value="">No room</option>
            {ROOM_OPTIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <button
            onClick={() => onDelete(photo)}
            className="h-10 w-10 rounded-full bg-white/10 text-white/70 flex items-center justify-center active:bg-destructive/20 active:text-destructive transition-colors"
            aria-label="Delete photo"
          >
            <Trash2 className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

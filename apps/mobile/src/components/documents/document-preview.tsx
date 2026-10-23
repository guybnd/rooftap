// HOUP-83: native port of apps/web/src/components/documents/document-preview.tsx.
// Web's modal (backdrop/Escape/iframe) has no RN equivalent — this renders as
// a BottomSheet instead, matching every other native "open detail" surface.
// Images render inline via expo-image; PDFs never reach this component — the
// caller (Documents list) routes a PDF straight to `openDocumentExternally`
// (expo-web-browser's Chrome Custom Tab / SFSafariViewController), per the
// approved plan's step 6. Anything else (a rare legacy non-image/pdf file)
// falls back to an "Open file" affordance via `Linking`.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { ExternalLink, FileText } from 'lucide-react-native';
import { Text, BottomSheet, Button } from '@homeup/ui';
import { signedDocumentUrl, SIGNED_URL_TTL_SECONDS } from '@homeup/core';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Matches apps/web/src/components/documents/document-preview.tsx's filename→kind regexes. */
export const isImageFilename = (filename: string) => /\.(jpe?g|png|webp|gif)$/i.test(filename);
export const isPdfFilename = (filename: string) => /\.pdf$/i.test(filename);

/** PDFs skip the in-app sheet entirely — open in an OS browser tab. */
export async function openDocumentExternally(
  supabase: SupabaseClient,
  storagePath: string,
  bucket: string
): Promise<boolean> {
  const url = await signedDocumentUrl(supabase, storagePath, SIGNED_URL_TTL_SECONDS, bucket);
  if (!url) return false;
  await WebBrowser.openBrowserAsync(url);
  return true;
}

interface DocumentPreviewProps {
  open: boolean;
  onClose: () => void;
  supabase: SupabaseClient;
  filename: string;
  storagePath: string;
  bucket: string;
  label?: string | null;
}

export function DocumentPreview({ open, onClose, supabase, filename, storagePath, bucket, label }: DocumentPreviewProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setUrl(null);
    setError(false);
    (async () => {
      const signed = await signedDocumentUrl(supabase, storagePath, SIGNED_URL_TTL_SECONDS, bucket);
      if (cancelled) return;
      if (signed) setUrl(signed);
      else setError(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, supabase, storagePath, bucket]);

  return (
    <BottomSheet open={open} onOpenChange={(next) => { if (!next) onClose(); }} className="max-h-[85%]">
      <View className="flex-row items-center gap-3 border-b border-border px-4 pb-3">
        <FileText size={16} className="shrink-0 text-muted-foreground" />
        <Text numberOfLines={1} className="flex-1 text-body font-medium text-foreground">
          {label || filename}
        </Text>
        {url && (
          <Pressable onPress={() => void Linking.openURL(url)} accessibilityRole="button" accessibilityLabel="Open externally" hitSlop={14}>
            <ExternalLink size={16} className="text-muted-foreground" />
          </Pressable>
        )}
      </View>
      <View className="min-h-64 items-center justify-center p-4">
        {error ? (
          <Text className="text-body text-muted-foreground">Could not load this file.</Text>
        ) : !url ? (
          <ActivityIndicator />
        ) : isImageFilename(filename) ? (
          <Image source={{ uri: url }} style={{ width: '100%', height: 320 }} contentFit="contain" />
        ) : (
          <View className="items-center gap-3">
            <Text className="text-center text-body text-muted-foreground">
              Preview isn&apos;t available for this file type.
            </Text>
            <Button onPress={() => void Linking.openURL(url)}>
              <ExternalLink size={16} className="text-primary-foreground" />
              <Text className="text-sm font-medium text-primary-foreground">Open file</Text>
            </Button>
          </View>
        )}
      </View>
    </BottomSheet>
  );
}

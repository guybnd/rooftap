// FlashList for screen tests: renders every row with no virtualisation, plus
// the header, footer and empty slots, the way a short list shows on a phone.
import * as React from 'react';
import { View } from 'react-native';

type Slot = React.ComponentType | React.ReactElement | null | undefined;

function slot(s: Slot) {
  if (!s) return null;
  if (React.isValidElement(s)) return s;
  const C = s as React.ComponentType;
  return <C />;
}

interface Props<T> {
  data?: readonly T[] | null;
  renderItem?: (info: { item: T; index: number; target: string; extraData?: unknown }) => React.ReactNode;
  keyExtractor?: (item: T, index: number) => string;
  ListHeaderComponent?: Slot;
  ListFooterComponent?: Slot;
  ListEmptyComponent?: Slot;
  extraData?: unknown;
}

function FlashListStub<T>(props: Props<T>, ref: React.Ref<unknown>) {
  React.useImperativeHandle(ref, () => ({ scrollToIndex: () => {}, scrollToOffset: () => {}, scrollToEnd: () => {}, prepareForLayoutAnimationRender: () => {} }));
  const data = props.data ?? [];
  return (
    <View>
      {slot(props.ListHeaderComponent)}
      {data.length === 0
        ? slot(props.ListEmptyComponent)
        : data.map((item, index) => (
            <React.Fragment key={props.keyExtractor ? props.keyExtractor(item, index) : index}>
              {props.renderItem?.({ item, index, target: 'Cell', extraData: props.extraData })}
            </React.Fragment>
          ))}
      {slot(props.ListFooterComponent)}
    </View>
  );
}

export const FlashList = React.forwardRef(FlashListStub);
export const AnimatedFlashList = FlashList;

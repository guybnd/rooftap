// Fixture for scan.test.mjs: every marked line must be reported.
import * as React from 'react';
import { Text, View } from 'react-native';

function Box({ title, children }: { title?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <View>
      {title}
      <View>{children}</View>
    </View>
  );
}

function Rows({ children }: { children?: React.ReactNode }) {
  const items = React.Children.toArray(children);
  return (
    <View>
      {items.map((child, i) => (
        <View key={i}>{child}</View>
      ))}
    </View>
  );
}

export function Bad({ count, label }: { count: number; label: string }) {
  return (
    <View>
      {count && <Text>items</Text>} {/* BAD */}
      {label} {/* BAD */}
      hello {/* BAD */}
      <Box title="Hi">raw</Box> {/* BAD x2 */}
      <Rows>{label}</Rows> {/* BAD */}
      {[1, 2].map((n) => `#${n}`)} {/* BAD */}
    </View>
  );
}

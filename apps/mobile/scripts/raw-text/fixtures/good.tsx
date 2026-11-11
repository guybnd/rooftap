// Fixture for scan.test.mjs: nothing here may be reported.
import * as React from 'react';
import { Text, View } from 'react-native';

function Label({ children }: { children?: React.ReactNode }) {
  return <Text>{children}</Text>;
}

function Chip({ children }: { children?: React.ReactNode }) {
  return <View>{typeof children === 'string' ? <Text>{children}</Text> : children}</View>;
}

export function Good({ count, label, icon }: { count: number; label?: string; icon?: React.ReactNode }) {
  return (
    <View>
      {count > 0 && <Text>{count} items</Text>}
      {!!count && <Text>items</Text>}
      {label && <Text>{label}</Text>}
      {icon}
      <Label>plain {label}</Label>
      <Chip>chip</Chip>
      <Text>
        <>
          {label} and {count}
        </>
      </Text>
      {/* raw-text-ok: a deliberate exception */}
      {label}
    </View>
  );
}

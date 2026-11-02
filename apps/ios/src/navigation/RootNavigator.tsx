import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { ConnectScreen } from '../screens/ConnectScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { useOmniTheme } from '../theme';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { colors } = useOmniTheme();

  return (
    <Stack.Navigator
      initialRouteName="Home"
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.fg,
        headerTitleStyle: { color: colors.fg },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="Connect"
        component={ConnectScreen}
        options={{ title: 'Connect', headerBackTitle: 'Home' }}
      />
    </Stack.Navigator>
  );
}

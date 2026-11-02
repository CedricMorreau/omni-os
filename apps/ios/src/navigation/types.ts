import type { Artifact } from '@omni/client-core';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

/** Every tab's stack takes these routes: its own root, and the detail routes any tab can push. */
export type RootStackParamList = {
  /** First run, and after the last server is removed or revoked. Only in the stack while there is no session. */
  Connect: undefined;
  /** The Activity tab's root, and home once a server is paired. */
  Activity: undefined;
  /** The Channels tab's root. */
  Channels: undefined;
  /** The Library tab's root. */
  Library: undefined;
  Channel: { id: string };
  Thread: { id: string };
  /** A file the crew made. Any tab can push it, through `openArtifact`. */
  Artifact: { artifact: Artifact };
  /** Search across thread titles and messages. Any tab's header opens it. */
  Search: undefined;
  /** Servers, devices, automations and the rest of what the app can change. Any tab's header opens it. */
  Settings: undefined;
  /** The devices signed in to the active server. */
  Devices: undefined;
  Automations: undefined;
  Servers: undefined;
  /** Pairing another server. A separate route, so pairing the first server swaps Connect out for the tabs. */
  AddServer: undefined;
};

/** The tab bar while a session is open, in phone web's order. */
export type TabsParamList = {
  ActivityTab: undefined;
  ChannelsTab: undefined;
  LibraryTab: undefined;
};

export type RootScreenProps<Name extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  Name
>;

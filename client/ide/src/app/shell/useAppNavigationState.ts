import { useRef, useState } from "react";
import { type ServerSubTab } from "../../features/server/ServerView";
import {
  type NavigationHistory,
  type NavigationLocation,
} from "./navigationState";
interface Dependencies {
  initialLocation: NavigationLocation;
}
export function useAppNavigationState({ initialLocation }: Dependencies) {
  const [activeTab, setActiveTab] = useState<string | null>(
    initialLocation.activeTab,
  );
  const [serverSubTab, setServerSubTab] = useState<ServerSubTab>(
    initialLocation.serverSubTab,
  );

  const [navigation, setNavigation] = useState<NavigationHistory>({
    entries: [initialLocation],
    index: 0,
  });
  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;

  return {
    activeTab,
    setActiveTab,
    setServerSubTab,
    navigationRef,
    setNavigation,
    serverSubTab,
    navigation,
  };
}

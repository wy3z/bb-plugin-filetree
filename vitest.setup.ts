import { beforeEach } from "vitest";
import { clearExplorerCaches } from "./ui/explorer/caches";

// The tree caches listings across mounts; each test starts cold.
beforeEach(() => clearExplorerCaches());

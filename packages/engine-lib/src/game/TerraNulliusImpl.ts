import { TerraNullius } from "@laukolaroser/engine-api/game/GameTypes";
import { ClientID } from "@laukolaroser/engine-api/Schemas";

export class TerraNulliusImpl implements TerraNullius {
  constructor() {}
  smallID(): number {
    return 0;
  }
  clientID(): ClientID {
    return "TERRA_NULLIUS_CLIENT_ID";
  }

  id() {
    return null;
  }

  isPlayer(): false {
    return false as const;
  }
}

# NestJS BFF reference

```ts
import { owlpane } from "@owlpane/node";
owlpane.start({ service: "nest-bff" });

import { Module } from "@nestjs/common";
import { OwlpaneModule } from "@owlpane/node/nest";

@Module({ imports: [OwlpaneModule] })
export class AppModule {}
```

`OwlpaneModule` calls `installNestJobTracing()` so `@Cron` and BullMQ processors become root spans.

Smoke: `node smoke.mjs` from this directory (no Nest install required).

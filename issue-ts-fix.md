## Bug: TypeScript build errors in EventCard.tsx

`npm run build` fails with 3 TypeScript errors:

```
src/ui/components/EventCard.tsx:161:22 - error TS2339: Property 'type' does not exist on type 'string | ContentBlockParam'.
src/ui/components/EventCard.tsx:601:19 - error TS2339: Property 'map' does not exist on type 'string | ContentBlockParam[]'.
src/ui/components/EventCard.tsx:602:23 - error TS2339: Property 'type' does not exist on type 'string | ContentBlockParam'.
```

### Root Cause
`messageContent` and `contents` can be either a string or object, but the code assumes they are always objects with `type` property.

### Fix
Add type guards to check if values are strings before accessing object properties.

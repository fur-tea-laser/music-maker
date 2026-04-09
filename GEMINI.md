use typescript

use functions only (DO NOT use classes)

for non-preact components, all top-level functions should take the generic form similar to the example below, but tailored to it's context and use case

```typescript
interface SomeFunctionNameApi {
  someFunctionArgument: string
  anotherFunctionArgument: number
  etc: unknown
}

function someFunctionName({ 
  someFunctionArgument, 
  anotherFunctionArgument, 
  etc 
}: SomeFunctionNameApi): ReturnType {
  // ... function implementation
}
```

variable and function names should be at least two full words long. don't use acronyms or abbreviate. use camelcase. single word names collide to easily with context and other names. multi-word names (two or more) help disambiguate and clarify purpose and context. don't use too many words as they can be difficult to visually parse and read plus they can be overly specific and mislead the reader. aim for two words if possible but three or more can be acceptable if needing to disambiguate between other names in other contexts. encapsulation in naming can be problematic, consider the names throughout the rest of the codebase for consistency and disambiguation. minimize introducing indirection when naming variables, for example variable names should just pass through functions as is rather than being assigned to a new name unless the function is shared and invoked across multiple contexts. 

when defining interfaces use the following generic-naming scheme for properties where each property starts with the last word of the interface name like so:

```typescript
interface SomeThing {
  thingId: number
  thingName: string
  thingAge: number
}
```

minimize error checking unless told explicity to validate/check certain conditions

don't use empty new lines at all, especially in function implementations, except for at the top level between/around declarations
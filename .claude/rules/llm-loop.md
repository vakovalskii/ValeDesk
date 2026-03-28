# LLM Agent Loop

## Overview

The agent loop in `runner-openai.ts` implements a ReAct-style agent that can:
1. Receive user messages
2. Stream LLM responses
3. Execute tools
4. Continue until task completion

## Loop Architecture

```
┌─────────────────────────────────────────────────┐
│                  Agent Loop                      │
│                                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │  Build   │───►│  Call    │───►│  Stream  │  │
│  │ Messages │    │   LLM    │    │ Response │  │
│  └──────────┘    └──────────┘    └──────────┘  │
│       ▲                               │         │
│       │                               ▼         │
│       │                        ┌──────────┐    │
│       │         No             │  Tool    │    │
│       └────────────────────────│  Calls?  │    │
│                                └──────────┘    │
│                                      │ Yes     │
│                                      ▼         │
│                               ┌──────────┐     │
│                               │ Execute  │     │
│                               │  Tools   │     │
│                               └──────────┘     │
│                                      │         │
│                                      ▼         │
│                               ┌──────────┐     │
│                               │   Add    │     │
│                               │ Results  │─────┘
│                               └──────────┘
└─────────────────────────────────────────────────┘
```

## Key Components

### Message Array

OpenAI chat format:

```typescript
type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[];
  tool_calls?: ToolCall[];      // Only for assistant
  tool_call_id?: string;        // Only for tool
  name?: string;                // Tool name for tool messages
};
```

### Streaming

Uses OpenAI SDK streaming with `requestAnimationFrame` throttling:

```typescript
const stream = await client.chat.completions.create({
  model: modelName,
  messages: messages,
  tools: activeTools,
  stream: true,
  stream_options: { include_usage: true }
});

for await (const chunk of stream) {
  // Process delta content
  if (chunk.choices[0]?.delta?.content) {
    sendStreamEvent(chunk.choices[0].delta.content);
  }
  
  // Accumulate tool calls
  if (chunk.choices[0]?.delta?.tool_calls) {
    accumulateToolCalls(chunk.choices[0].delta.tool_calls);
  }
}
```

### Tool Execution Flow

```typescript
// 1. Check permission mode
const permissionMode = settings?.permissionMode || 'ask';

if (permissionMode === 'ask') {
  // 2. Send permission request to UI
  sendPermissionRequest(toolUseId, toolName, toolArgs);
  
  // 3. Wait for user response
  const approved = await waitForPermission(toolUseId);
  if (!approved) continue;
}

// 4. Execute tool
const result = await toolExecutor.executeTool(toolName, toolArgs, {
  sessionId: session.id,
  onTodosChanged: (todos) => {
    // Persist and notify UI
  }
});

// 5. Add result to messages
messages.push({
  role: 'tool',
  tool_call_id: toolCall.id,
  name: toolName,
  content: result.success ? result.output : `Error: ${result.error}`
});
```

## Loop Detection

Prevents infinite loops when model repeatedly calls same tool:

```typescript
const LOOP_THRESHOLD = 5;      // Same tool N times = loop
const MAX_LOOP_RETRIES = 5;    // Max attempts to break loop

// Track recent tool calls
recentToolCalls.push({ name: toolName, args: argsString });

// Check for loops
if (recentToolCalls.length >= LOOP_THRESHOLD) {
  const lastCalls = recentToolCalls.slice(-LOOP_THRESHOLD);
  const allSameTool = lastCalls.every(c => c.name === lastCalls[0].name);
  
  if (allSameTool) {
    loopRetryCount++;
    
    if (loopRetryCount >= MAX_LOOP_RETRIES) {
      // Stop with error
      sendLoopError(toolName);
      return;
    }
    
    // Add hint to help model break loop
    messages.push({
      role: 'user',
      content: '⚠️ You are stuck in a loop. Try a different approach.'
    });
  }
}
```

## Error Handling

### Retryable Errors

Network errors are automatically retried:

```typescript
const isRetryableNetworkError = (error: unknown): boolean => {
  const code = error.cause?.code;
  const status = error.status;
  
  // Retry on socket errors
  if (['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED'].includes(code)) {
    return true;
  }
  
  // Retry on server errors
  if ([429, 500, 502, 503, 504].includes(status)) {
    return true;
  }
  
  return false;
};
```

### Retry Logic

```typescript
const MAX_STREAM_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;

for (let attempt = 0; attempt <= MAX_STREAM_RETRIES; attempt++) {
  try {
    return await streamResponse();
  } catch (error) {
    if (!isRetryableNetworkError(error) || attempt === MAX_STREAM_RETRIES) {
      throw error;
    }
    
    const delayMs = RETRY_BASE_DELAY_MS * 2 ** attempt;
    await sleep(delayMs);
  }
}
```

## Session Logging

Each turn is logged to `~/.localdesk/logs/sessions/{sessionId}/`:

```
turn-001-request.json   # Full request (messages, tools, params)
turn-001-response.json  # Full response (content, tool_calls, usage)
turn-002-request.json
turn-002-response.json
...
```

## Token Tracking

Accumulated across all iterations:

```typescript
if (streamMetadata.usage) {
  totalInputTokens += streamMetadata.usage.prompt_tokens || 0;
  totalOutputTokens += streamMetadata.usage.completion_tokens || 0;
}

// Final report
sendMessage('result', {
  usage: {
    input_tokens: totalInputTokens,
    output_tokens: totalOutputTokens
  }
});
```

## Abort Handling

User can stop generation at any point:

```typescript
let aborted = false;

return {
  abort: () => {
    aborted = true;
    console.log('[OpenAI Runner] Aborted');
  }
};

// Check in loop
while (!aborted && iterationCount < MAX_ITERATIONS) {
  // ... streaming
  if (aborted) break;
  
  // ... tool execution
  if (aborted) break;
}
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `MAX_ITERATIONS` | 50 | Max agent loop cycles |
| `REQUEST_TIMEOUT_MS` | 5 min | LLM request timeout |
| `MAX_STREAM_RETRIES` | 3 | Network error retries |
| `LOOP_THRESHOLD` | 5 | Tool calls to detect loop |

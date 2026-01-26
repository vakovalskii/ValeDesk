/**
 * Browser Automation Tools - Headless browser control using Playwright
 *
 * Tools:
 * - browser_navigate: Navigate to a URL
 * - browser_click: Click an element
 * - browser_type: Type text into an input
 * - browser_select: Select from dropdown
 * - browser_hover: Hover over element
 * - browser_scroll: Scroll page
 * - browser_press_key: Press keyboard key
 * - browser_wait_for: Wait for element/timeout
 * - browser_snapshot: Get accessibility snapshot
 * - browser_screenshot: Take screenshot
 * - browser_execute_script: Execute JavaScript
 *
 * Requires: playwright (headless Chromium)
 */

import type {
  ToolDefinition,
  ToolResult,
  ToolExecutionContext,
} from "./base-tool.js";

// Playwright will be dynamically imported to avoid errors if not installed
let playwright: any = null;
let browser: any = null;
let page: any = null;

// ============================================================================
// Tool Definitions
// ============================================================================

export const BrowserNavigateToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "browser_navigate",
    description: `Open and navigate to a URL in a headless browser. CALL THIS FIRST to open any webpage in the browser.

**IMPORTANT:** This is the tool to open/visit URLs in the browser (there is NO "browser_open" tool).

**Use this for:**
- Opening interactive websites requiring JavaScript
- Sites that need cookies/sessions
- Dynamic content loading
- Any webpage you want to interact with

**Don't use for:**
- Simple static pages (use fetch_html instead - 10x faster)
- API endpoints (use fetch or fetch_json)

**After navigating:** Call browser_snapshot to see what's on the page

**Parameters:**
- url: URL to navigate to (required)
- wait_for: What to wait for (load, networkidle, domcontentloaded, default: load)

**Returns:**
- Current page URL
- Page title
- Success status`,
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to navigate to",
        },
        wait_for: {
          type: "string",
          enum: ["load", "networkidle", "domcontentloaded"],
          description: "Wait condition (default: load)",
        },
      },
      required: ["url"],
    },
  },
};

export const BrowserClickToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "browser_click",
    description: `Click an element in the browser.

**Parameters:**
- selector: CSS selector to click (required)
- timeout: Wait timeout in ms (default: 30000)

**Returns:**
- Success status
- Current page URL after click`,
    parameters: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector to click",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 30000)",
        },
      },
      required: ["selector"],
    },
  },
};

export const BrowserTypeToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "browser_type",
    description: `Type text into an input field.

**Parameters:**
- selector: CSS selector of the input (required)
- text: Text to type (required)
- delay: Delay between keystrokes in ms (default: 0)

**Returns:**
- Success status`,
    parameters: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector of the input field",
        },
        text: {
          type: "string",
          description: "Text to type",
        },
        delay: {
          type: "number",
          description: "Delay between keystrokes (default: 0)",
        },
      },
      required: ["selector", "text"],
    },
  },
};

export const BrowserSelectToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "browser_select",
    description: `Select an option from a dropdown.

**Parameters:**
- selector: CSS selector of the select element (required)
- value: Value to select (required)

**Returns:**
- Success status
- Selected values`,
    parameters: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector of the select element",
        },
        value: {
          type: "string",
          description: "Value to select",
        },
      },
      required: ["selector", "value"],
    },
  },
};

export const BrowserHoverToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "browser_hover",
    description: `Hover over an element.

**Parameters:**
- selector: CSS selector of the element (required)

**Returns:**
- Success status`,
    parameters: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector of the element",
        },
      },
      required: ["selector"],
    },
  },
};

export const BrowserScrollToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "browser_scroll",
    description: `Scroll the page.

**Parameters:**
- direction: Direction to scroll (up, down, left, right, required)
- amount: Pixels to scroll (default: 500)

**Returns:**
- Success status
- New scroll position`,
    parameters: {
      type: "object",
      properties: {
        direction: {
          type: "string",
          enum: ["up", "down", "left", "right"],
          description: "Direction to scroll",
        },
        amount: {
          type: "number",
          description: "Pixels to scroll (default: 500)",
        },
      },
      required: ["direction"],
    },
  },
};

export const BrowserPressKeyToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "browser_press_key",
    description: `Press a keyboard key.

**Parameters:**
- key: Key to press (Enter, Escape, ArrowDown, etc., required)

**Returns:**
- Success status`,
    parameters: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Key to press (e.g., Enter, Escape, Tab, ArrowDown)",
        },
      },
      required: ["key"],
    },
  },
};

export const BrowserWaitForToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "browser_wait_for",
    description: `Wait for an element or timeout.

**Parameters:**
- selector: CSS selector to wait for (optional)
- timeout: Timeout in milliseconds (required if no selector)

**Returns:**
- Success status`,
    parameters: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector to wait for",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds",
        },
      },
      required: [],
    },
  },
};

export const BrowserSnapshotToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "browser_snapshot",
    description: `Get accessibility snapshot of the page.

**Returns:**
- Accessible tree structure
- Interactive elements
- Text content`,
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

export const BrowserScreenshotToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "browser_screenshot",
    description: `Take a screenshot of the page.

**Parameters:**
- path: File path to save screenshot (required)
- full_page: Capture full page (default: false)

**Returns:**
- Screenshot file path
- Success status`,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path to save screenshot",
        },
        full_page: {
          type: "boolean",
          description: "Capture full scrollable page (default: false)",
        },
      },
      required: ["path"],
    },
  },
};

export const BrowserExecuteScriptToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "browser_execute_script",
    description: `Execute JavaScript in the browser context.

**Parameters:**
- script: JavaScript code to execute (required)

**Returns:**
- Script execution result`,
    parameters: {
      type: "object",
      properties: {
        script: {
          type: "string",
          description: "JavaScript code to execute",
        },
      },
      required: ["script"],
    },
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

async function ensureBrowser() {
  if (!playwright) {
    try {
      playwright = await import("playwright");
    } catch (error) {
      throw new Error(
        "Playwright is not installed. Run: npm install playwright",
      );
    }
  }

  if (!browser) {
    browser = await playwright.chromium.launch({ headless: true });
  }

  if (!page) {
    page = await browser.newPage();
  }

  return page;
}

async function closeBrowser() {
  if (page) {
    await page.close();
    page = null;
  }
  if (browser) {
    await browser.close();
    browser = null;
  }
}

// ============================================================================
// Tool Executors
// ============================================================================

export async function executeBrowserNavigateTool(
  args: { url: string; wait_for?: string },
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const { url, wait_for = "load" } = args;

  try {
    const page = await ensureBrowser();
    await page.goto(url, { waitUntil: wait_for });

    const title = await page.title();
    const currentUrl = page.url();

    return {
      success: true,
      output: `Navigated to: ${currentUrl}\nTitle: ${title}`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to navigate to ${url}: ${error.message}`,
    };
  }
}

export async function executeBrowserClickTool(
  args: { selector: string; timeout?: number },
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const { selector, timeout = 30000 } = args;

  try {
    const page = await ensureBrowser();
    await page.click(selector, { timeout });

    const currentUrl = page.url();

    return {
      success: true,
      output: `Clicked: ${selector}\nCurrent URL: ${currentUrl}`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to click ${selector}: ${error.message}`,
    };
  }
}

export async function executeBrowserTypeTool(
  args: { selector: string; text: string; delay?: number },
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const { selector, text, delay = 0 } = args;

  try {
    const page = await ensureBrowser();
    await page.type(selector, text, { delay });

    return {
      success: true,
      output: `Typed text into: ${selector}`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to type into ${selector}: ${error.message}`,
    };
  }
}

export async function executeBrowserSelectTool(
  args: { selector: string; value: string },
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const { selector, value } = args;

  try {
    const page = await ensureBrowser();
    const selectedValues = await page.selectOption(selector, value);

    return {
      success: true,
      output: `Selected: ${value}\nSelected values: ${selectedValues.join(", ")}`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to select from ${selector}: ${error.message}`,
    };
  }
}

export async function executeBrowserHoverTool(
  args: { selector: string },
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const { selector } = args;

  try {
    const page = await ensureBrowser();
    await page.hover(selector);

    return {
      success: true,
      output: `Hovered over: ${selector}`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to hover over ${selector}: ${error.message}`,
    };
  }
}

export async function executeBrowserScrollTool(
  args: { direction: string; amount?: number },
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const { direction, amount = 500 } = args;

  try {
    const page = await ensureBrowser();

    let scrollScript = "";
    switch (direction) {
      case "down":
        scrollScript = `window.scrollBy(0, ${amount})`;
        break;
      case "up":
        scrollScript = `window.scrollBy(0, -${amount})`;
        break;
      case "right":
        scrollScript = `window.scrollBy(${amount}, 0)`;
        break;
      case "left":
        scrollScript = `window.scrollBy(-${amount}, 0)`;
        break;
    }

    await page.evaluate(scrollScript);
    const scrollPosition = await page.evaluate(() => ({
      x: window.scrollX,
      y: window.scrollY,
    }));

    return {
      success: true,
      output: `Scrolled ${direction} by ${amount}px\nPosition: (${scrollPosition.x}, ${scrollPosition.y})`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to scroll ${direction}: ${error.message}`,
    };
  }
}

export async function executeBrowserPressKeyTool(
  args: { key: string },
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const { key } = args;

  try {
    const page = await ensureBrowser();
    await page.keyboard.press(key);

    return {
      success: true,
      output: `Pressed key: ${key}`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to press key ${key}: ${error.message}`,
    };
  }
}

export async function executeBrowserWaitForTool(
  args: { selector?: string; timeout?: number },
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const { selector, timeout } = args;

  try {
    const page = await ensureBrowser();

    if (selector) {
      await page.waitForSelector(selector, { timeout });
      return {
        success: true,
        output: `Element appeared: ${selector}`,
      };
    } else if (timeout) {
      await page.waitForTimeout(timeout);
      return {
        success: true,
        output: `Waited for ${timeout}ms`,
      };
    } else {
      return {
        success: false,
        error: "Must provide either selector or timeout",
      };
    }
  } catch (error: any) {
    return {
      success: false,
      error: `Wait failed: ${error.message}`,
    };
  }
}

export async function executeBrowserSnapshotTool(
  args: {},
  context: ToolExecutionContext,
): Promise<ToolResult> {
  try {
    const page = await ensureBrowser();
    const snapshot = await page.accessibility.snapshot();

    return {
      success: true,
      output: JSON.stringify(snapshot, null, 2),
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to get snapshot: ${error.message}`,
    };
  }
}

export async function executeBrowserScreenshotTool(
  args: { path: string; full_page?: boolean },
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const { path, full_page = false } = args;

  if (!context.isPathSafe(path)) {
    return {
      success: false,
      error: `Access denied: Path is outside the working directory (${context.cwd})`,
    };
  }

  try {
    const page = await ensureBrowser();
    await page.screenshot({ path, fullPage: full_page });

    return {
      success: true,
      output: `Screenshot saved to: ${path}`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to take screenshot: ${error.message}`,
    };
  }
}

export async function executeBrowserExecuteScriptTool(
  args: { script: string },
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const { script } = args;

  try {
    const page = await ensureBrowser();
    const result = await page.evaluate(script);

    return {
      success: true,
      output: JSON.stringify(result, null, 2),
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Script execution failed: ${error.message}`,
    };
  }
}

// ============================================================================
// Export All Tool Definitions
// ============================================================================

export const ALL_BROWSER_TOOL_DEFINITIONS = [
  BrowserNavigateToolDefinition,
  BrowserClickToolDefinition,
  BrowserTypeToolDefinition,
  BrowserSelectToolDefinition,
  BrowserHoverToolDefinition,
  BrowserScrollToolDefinition,
  BrowserPressKeyToolDefinition,
  BrowserWaitForToolDefinition,
  BrowserSnapshotToolDefinition,
  BrowserScreenshotToolDefinition,
  BrowserExecuteScriptToolDefinition,
];

// Export cleanup function
export { closeBrowser };

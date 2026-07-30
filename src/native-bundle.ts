import { PLUGIN_NAME } from './constants.js'

const TARGET_SDK_VERSION = '3.2'
const BACKGROUND_MODULE_ID = '/background.js'
const APP_SERVICE_MODULE_ID = '/app-service.js'

const INJECTED_RUNTIME_VARIABLES = [
  'Card',
  'setTimeout',
  'setInterval',
  'clearInterval',
  'clearTimeout',
  'NativeModules',
  'tt',
  'console',
  'Component',
  'ReactLynx',
  'nativeAppId',
  'Behavior',
  'LynxJSBI',
  'lynx',
  'window',
  'document',
  'frames',
  'self',
  'location',
  'navigator',
  'localStorage',
  'history',
  'Caches',
  'screen',
  'alert',
  'confirm',
  'prompt',
  'fetch',
  'XMLHttpRequest',
  '__WebSocket__',
  'webkit',
  'Reporter',
  'print',
  'global',
  'requestAnimationFrame',
  'cancelAnimationFrame',
] as const

export interface EncodeNativeBundleOptions {
  backgroundCode: string
  mainThreadCode: string
  styles: string[]
}

export async function encodeNativeBundle({
  backgroundCode,
  mainThreadCode,
  styles,
}: EncodeNativeBundleOptions): Promise<Uint8Array> {
  let cssSerializer: typeof import('@lynx-js/css-serializer')
  let tasm: typeof import('@lynx-js/tasm')
  try {
    ;[cssSerializer, tasm] = await Promise.all([
      import('@lynx-js/css-serializer'),
      import('@lynx-js/tasm'),
    ])
  } catch (error) {
    throw new Error(
      `[${PLUGIN_NAME}] the experimental Nasti backend requires ` +
        '"@lynx-js/css-serializer" and "@lynx-js/tasm". Install the native ' +
        'backend peers before building.',
      { cause: error },
    )
  }

  const { cssMap, cssSource } = cssSerializer.cssChunksToMap(
    styles,
    [],
    true,
  )
  const encode = tasm.getEncodeMode()
  const result = await encode({
    compilerOptions: {
      enableFiberArch: true,
      useLepusNG: true,
      enableReuseContext: true,
      bundleModuleMode: 'ReturnByFunction',
      templateDebugUrl: '',
      debugInfoOutside: true,
      defaultDisplayLinear: true,
      enableCSSInvalidation: true,
      enableCSSSelector: true,
      enableLepusDebug: false,
      enableRemoveCSSScope: false,
      targetSdkVersion: TARGET_SDK_VERSION,
      defaultOverflowVisible: true,
    },
    sourceContent: {
      dsl: 'react_nodiff',
      appType: 'card',
      config: {
        lepusStrict: true,
        useNewSwiper: true,
        enableNewIntersectionObserver: true,
        enableNativeList: true,
        enableNewSticky: true,
        flexBasisZeroPercent: true,
        enableGridPlacementShorthands: true,
        syncXElementRegistry: true,
        enableA11y: true,
        enableAccessibilityElement: false,
        enableCSSInheritance: false,
        enableNewGesture: false,
        removeDescendantSelectorScope: true,
        debugMetadataUrl: '',
      },
    },
    css: {
      cssMap,
      cssSource,
    },
    lepusCode: {
      root: mainThreadCode,
      lepusChunk: {},
      filename: 'main-thread.js',
    },
    manifest: {
      [APP_SERVICE_MODULE_ID]: createAppService(),
      [BACKGROUND_MODULE_ID]: wrapBackgroundBundle(backgroundCode),
    },
    customSections: {},
  })

  if (result.status !== 0 || !result.buffer) {
    throw new Error(
      `[${PLUGIN_NAME}] TASM encoding failed: ` +
        (result.error_msg || `status ${result.status}`),
    )
  }
  return new Uint8Array(result.buffer)
}

export function wrapBackgroundBundle(code: string): string {
  const injected = INJECTED_RUNTIME_VARIABLES.join(',')
  return `(function(){
'use strict';
var g=globalThis;
function __init_card_bundle__(lynxCoreInject){
g.__bundle__holder=undefined;
var globDynamicComponentEntry=g.globDynamicComponentEntry||'__Card__';
var tt=lynxCoreInject.tt;
tt.define(${JSON.stringify(BACKGROUND_MODULE_ID)},function(require,module,exports,${injected}){
lynx=lynx||{};
lynx.targetSdkVersion=lynx.targetSdkVersion||${JSON.stringify(TARGET_SDK_VERSION)};
var Promise=lynx.Promise;
fetch=fetch||lynx.fetch;
requestAnimationFrame=requestAnimationFrame||lynx.requestAnimationFrame;
cancelAnimationFrame=cancelAnimationFrame||lynx.cancelAnimationFrame;
${code}
});
return tt.require(${JSON.stringify(BACKGROUND_MODULE_ID)});
}
if(g&&g.bundleSupportLoadScript){
var res={init:__init_card_bundle__};
g.__bundle__holder=res;
return res;
}
__init_card_bundle__({"tt":tt});
})();`
}

export function createAppService(): string {
  return `(function(){'use strict';function n({tt}){tt.define('${
    APP_SERVICE_MODULE_ID
  }',function(e,module,_,i,l,u,a,c,s,f,p,d,h,v,g,y,lynx){module.exports=lynx.requireModule(${
    JSON.stringify(BACKGROUND_MODULE_ID)
  },globDynamicComponentEntry?globDynamicComponentEntry:'__Card__');});return tt.require('${
    APP_SERVICE_MODULE_ID
  }');}return{init:n}})()`
}

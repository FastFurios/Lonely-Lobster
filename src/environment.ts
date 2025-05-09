//----------------------------------------------------------------------
/**
 * ENVIRONMENT
 */
 //----------------------------------------------------------------------
// last code cleaning: 04.01.2025

/** environment information of the Lonely Lobster backend */

export const environment = {
    version: "7.1.1",
    notes: "fixing bug Lonely-Lobster-UI #29 (optimize WIP limit: occasionally limit below 0)",
      // msal config details 
    msalConfig: {
      tenant:"<use your own Azure tenant>",
      applicationId: "<use your own Azure application ID for the backend>"
    }
  }
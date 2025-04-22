//----------------------------------------------------------------------
/**
 * ENVIRONMENT
 */
 //----------------------------------------------------------------------
// last code cleaning: 04.01.2025

/** environment information of the Lonely Lobster backend */

export const environment = {
    version: "7.0.2",
    notes: "fixed bug #34 WIP limit does not work",
      // msal config details 
    msalConfig: {
      tenant:"<use your own Azure tenant>",
      applicationId: "<use your own Azure application ID for the backend>"
    }
  }
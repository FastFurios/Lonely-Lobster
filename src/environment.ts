//----------------------------------------------------------------------
/**
 * ENVIRONMENT
 */
 //----------------------------------------------------------------------
// last code cleaning: 04.01.2025

/** environment information of the Lonely Lobster backend */

export const environment = {
    version: "7.1.0",
    notes: "fixed bug #36 (introduced buffer process steps) and #37 (implemented First finished first out priciple fpr process steps)",
      // msal config details 
    msalConfig: {
      tenant:"<use your own Azure tenant>",
      applicationId: "<use your own Azure application ID for the backend>"
    }
  }
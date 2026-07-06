// RTA / CUD challenge "key locations" - the city-wide monitoring sites and signal
// junctions referenced in the traffic dataset (docs/CUD_RTA_Traffic_Dataset).
// Parsed verbatim from datasets/locations_reference.csv and
// signal_junctions_reference.csv so the twin can plot and inspect them.

export type RtaProfile = "cin" | "cout" | "frgt" | "leis" | "mix";
export type RtaControlType = "SCOOT-adaptive" | "Fixed-time";

export type RtaSite = {
  kind: "site";
  id: string;
  name: string;
  roadCode: string;
  roadName: string;
  area: string;
  direction: string;
  numLanes: number;
  freeFlowSpeed: number;
  speedLimit: number;
  capacity: number;
  aadt: number;
  profile: RtaProfile;
  lat: number;
  lon: number;
};

export type RtaJunction = {
  kind: "junction";
  id: string;
  name: string;
  area: string;
  numApproaches: number;
  peakDemand: number;
  controlType: RtaControlType;
  lat: number;
  lon: number;
};

export type RtaLocation = RtaSite | RtaJunction;

export const rtaSites: RtaSite[] = [
  { kind: "site", id: "SZR_N1", name: "Sheikh Zayed Rd @ 1st Interchange (Defence)", roadCode: "E11", roadName: "Sheikh Zayed Road", area: "Trade Centre", direction: "NB (to Deira)", numLanes: 6, freeFlowSpeed: 105, speedLimit: 100, capacity: 12000, aadt: 138000, profile: "cin", lat: 25.223, lon: 55.282 },
  { kind: "site", id: "SZR_S1", name: "Sheikh Zayed Rd @ 1st Interchange (Defence)", roadCode: "E11", roadName: "Sheikh Zayed Road", area: "Trade Centre", direction: "SB (to Abu Dhabi)", numLanes: 6, freeFlowSpeed: 105, speedLimit: 100, capacity: 12000, aadt: 132000, profile: "cout", lat: 25.2228, lon: 55.2832 },
  { kind: "site", id: "SZR_N2", name: "Sheikh Zayed Rd @ Financial Centre (DIFC)", roadCode: "E11", roadName: "Sheikh Zayed Road", area: "DIFC", direction: "NB (to Deira)", numLanes: 6, freeFlowSpeed: 105, speedLimit: 100, capacity: 12000, aadt: 134000, profile: "cin", lat: 25.211, lon: 55.279 },
  { kind: "site", id: "SZR_S2", name: "Sheikh Zayed Rd @ Financial Centre (DIFC)", roadCode: "E11", roadName: "Sheikh Zayed Road", area: "DIFC", direction: "SB (to Abu Dhabi)", numLanes: 6, freeFlowSpeed: 105, speedLimit: 100, capacity: 12000, aadt: 130000, profile: "cout", lat: 25.2108, lon: 55.2802 },
  { kind: "site", id: "SZR_N4", name: "Sheikh Zayed Rd @ 4th Interchange (Mall of Emirates)", roadCode: "E11", roadName: "Sheikh Zayed Road", area: "Al Barsha", direction: "NB (to Deira)", numLanes: 7, freeFlowSpeed: 105, speedLimit: 100, capacity: 13500, aadt: 142000, profile: "cin", lat: 25.118, lon: 55.2 },
  { kind: "site", id: "SZR_S4", name: "Sheikh Zayed Rd @ 4th Interchange (Mall of Emirates)", roadCode: "E11", roadName: "Sheikh Zayed Road", area: "Al Barsha", direction: "SB (to Abu Dhabi)", numLanes: 7, freeFlowSpeed: 105, speedLimit: 100, capacity: 13500, aadt: 140000, profile: "cout", lat: 25.1178, lon: 55.2012 },
  { kind: "site", id: "EKR_N1", name: "Al Khail Rd @ Business Bay", roadCode: "E44", roadName: "Al Khail Road", area: "Business Bay", direction: "NB (to Deira)", numLanes: 5, freeFlowSpeed: 100, speedLimit: 100, capacity: 10000, aadt: 98000, profile: "cin", lat: 25.186, lon: 55.27 },
  { kind: "site", id: "EKR_S1", name: "Al Khail Rd @ Al Quoz", roadCode: "E44", roadName: "Al Khail Road", area: "Al Quoz", direction: "SB (to Jebel Ali)", numLanes: 5, freeFlowSpeed: 100, speedLimit: 100, capacity: 10000, aadt: 95000, profile: "cout", lat: 25.149, lon: 55.235 },
  { kind: "site", id: "MBZ_E1", name: "Mohammed Bin Zayed Rd @ Dubai Investment Park", roadCode: "E311", roadName: "Mohammed Bin Zayed Road", area: "DIP", direction: "Both (sample EB)", numLanes: 6, freeFlowSpeed: 110, speedLimit: 110, capacity: 11000, aadt: 86000, profile: "frgt", lat: 24.99, lon: 55.17 },
  { kind: "site", id: "EMR_E1", name: "Emirates Rd @ Al Awir", roadCode: "E611", roadName: "Emirates Road", area: "Al Awir", direction: "Both (sample EB)", numLanes: 5, freeFlowSpeed: 110, speedLimit: 110, capacity: 9000, aadt: 62000, profile: "frgt", lat: 25.17, lon: 55.44 },
  { kind: "site", id: "ITT_W1", name: "Al Ittihad Rd @ Al Mamzar (Dubai-Sharjah border)", roadCode: "D89", roadName: "Al Ittihad Road", area: "Al Mamzar", direction: "WB (to Dubai)", numLanes: 5, freeFlowSpeed: 80, speedLimit: 80, capacity: 7000, aadt: 96000, profile: "cin", lat: 25.295, lon: 55.355 },
  { kind: "site", id: "ITT_E1", name: "Al Ittihad Rd @ Al Qiyadah", roadCode: "D89", roadName: "Al Ittihad Road", area: "Al Qiyadah", direction: "EB (to Sharjah)", numLanes: 5, freeFlowSpeed: 80, speedLimit: 80, capacity: 7000, aadt: 90000, profile: "cout", lat: 25.268, lon: 55.338 },
  { kind: "site", id: "AIR_W1", name: "Airport Rd @ Al Garhoud", roadCode: "D89", roadName: "Airport Road", area: "Al Garhoud", direction: "WB (to city)", numLanes: 4, freeFlowSpeed: 80, speedLimit: 80, capacity: 6000, aadt: 72000, profile: "cin", lat: 25.248, lon: 55.352 },
  { kind: "site", id: "GAR_N1", name: "Al Garhoud Bridge", roadCode: "D75", roadName: "Al Garhoud Bridge", area: "Garhoud", direction: "NB (to Deira)", numLanes: 5, freeFlowSpeed: 80, speedLimit: 80, capacity: 7000, aadt: 82000, profile: "mix", lat: 25.233, lon: 55.33 },
  { kind: "site", id: "MAK_N1", name: "Al Maktoum Bridge", roadCode: "D75", roadName: "Al Maktoum Bridge", area: "Bur Dubai", direction: "NB (to Deira)", numLanes: 4, freeFlowSpeed: 60, speedLimit: 60, capacity: 6000, aadt: 68000, profile: "mix", lat: 25.24, lon: 55.317 },
  { kind: "site", id: "BBC_S1", name: "Business Bay Crossing", roadCode: "E11", roadName: "Business Bay Crossing", area: "Business Bay", direction: "SB (to Bur Dubai)", numLanes: 5, freeFlowSpeed: 80, speedLimit: 80, capacity: 8000, aadt: 86000, profile: "mix", lat: 25.192, lon: 55.29 },
  { kind: "site", id: "JBR_X1", name: "Jumeirah Beach Rd @ Jumeirah 1", roadCode: "D94", roadName: "Jumeirah Beach Road", area: "Jumeirah", direction: "Both (sample)", numLanes: 3, freeFlowSpeed: 60, speedLimit: 60, capacity: 4000, aadt: 34000, profile: "leis", lat: 25.208, lon: 55.248 },
  { kind: "site", id: "DWC_X1", name: "Expo Rd @ Dubai South / DWC", roadCode: "E77", roadName: "Expo Road", area: "Dubai South", direction: "Both (sample)", numLanes: 4, freeFlowSpeed: 100, speedLimit: 100, capacity: 6000, aadt: 29000, profile: "mix", lat: 24.896, lon: 55.161 }
];

export const rtaJunctions: RtaJunction[] = [
  { kind: "junction", id: "JCT_DEF", name: "Defence Roundabout Signals", area: "Trade Centre", numApproaches: 4, peakDemand: 1500, controlType: "SCOOT-adaptive", lat: 25.2235, lon: 55.2845 },
  { kind: "junction", id: "JCT_SAFA", name: "Al Safa Junction", area: "Al Safa", numApproaches: 4, peakDemand: 1200, controlType: "SCOOT-adaptive", lat: 25.188, lon: 55.252 },
  { kind: "junction", id: "JCT_WASL", name: "Al Wasl / Al Hadiqa Junction", area: "Al Wasl", numApproaches: 4, peakDemand: 1000, controlType: "Fixed-time", lat: 25.196, lon: 55.244 },
  { kind: "junction", id: "JCT_OUD", name: "Oud Metha Junction", area: "Oud Metha", numApproaches: 4, peakDemand: 1100, controlType: "SCOOT-adaptive", lat: 25.235, lon: 55.312 },
  { kind: "junction", id: "JCT_GARH", name: "Al Garhoud Junction", area: "Garhoud", numApproaches: 4, peakDemand: 1300, controlType: "SCOOT-adaptive", lat: 25.241, lon: 55.346 },
  { kind: "junction", id: "JCT_MAMZ", name: "Al Mamzar Junction", area: "Al Mamzar", numApproaches: 4, peakDemand: 1400, controlType: "Fixed-time", lat: 25.294, lon: 55.35 },
  { kind: "junction", id: "JCT_QUOZ", name: "Al Quoz Junction", area: "Al Quoz", numApproaches: 3, peakDemand: 900, controlType: "Fixed-time", lat: 25.143, lon: 55.233 },
  { kind: "junction", id: "JCT_BARSHA", name: "Al Barsha Junction", area: "Al Barsha", numApproaches: 4, peakDemand: 1150, controlType: "SCOOT-adaptive", lat: 25.112, lon: 55.198 },
  { kind: "junction", id: "JCT_KARAMA", name: "Karama / Trade Centre Junction", area: "Karama", numApproaches: 4, peakDemand: 1250, controlType: "SCOOT-adaptive", lat: 25.247, lon: 55.304 },
  { kind: "junction", id: "JCT_DEIRA", name: "Deira / Al Ittihad Junction", area: "Deira", numApproaches: 4, peakDemand: 1350, controlType: "Fixed-time", lat: 25.271, lon: 55.334 }
];

export const rtaKeyLocations: RtaLocation[] = [...rtaSites, ...rtaJunctions];

// Marker colors.
export const profileColor: Record<RtaProfile, string> = {
  cin: "#2563EB", // commuter inbound
  cout: "#7C3AED", // commuter outbound
  frgt: "#475569", // freight
  leis: "#0D9488", // leisure
  mix: "#D97706" // mixed
};

export const profileLabel: Record<RtaProfile, string> = {
  cin: "Commuter (inbound)",
  cout: "Commuter (outbound)",
  frgt: "Freight",
  leis: "Leisure",
  mix: "Mixed"
};

export const controlColor: Record<RtaControlType, string> = {
  "SCOOT-adaptive": "#2EC4A0",
  "Fixed-time": "#F59E0B"
};

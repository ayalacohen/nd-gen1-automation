const config = {
  apiBaseUrl: "http://localhost:5678",
  language: process.env.LANGUAGE||"en_US",
  appPackage: "com.neuroderm.station",
  // mapping from language code to visible label in language selection screen
  languageLabels: {
    en_US: 'English - US',
    en_150: 'English - Europe',
    de_DE: 'Deutsch - German'
  },

  globalParams: {
    pumpName: process.env.PUMP_NAME,
    portName: process.env.PORT_NAME,
    defaultPumpPinCode: "000000",
    defaultRegimenPinCode: "06120000",
    // mainSN: "987654321",
    mainSN: "1930000886",
    doseMapping: {
      720: {
        dayDose: 690, dayFlowRate: 640, nightDose: 30, nightFlowRate: 80, totalDose: 720,
        intervals: {
          day: [56, 56, 56, 57],
          night: [450]
        }
      },
      670: {
        dayDose: 640, dayFlowRate: 590, nightDose: 30, nightFlowRate: 80, totalDose: 670,
        intervals: {
          day: [61],
          night: [450]
        }
      },
      620: {
        dayDose: 590, dayFlowRate: 550, nightDose: 30, nightFlowRate: 80, totalDose: 620,
        intervals: {
          day: [65, 65,	66,	65,	66,	65,	66,	65,	66,	65,	65,	66,	65,	66,	65,	66,	65,	66,	65,	66],
          night: [450]
        }
      },
      570: {
        dayDose: 540, dayFlowRate: 500, nightDose: 30, nightFlowRate: 80, totalDose: 570,
        intervals: {
          day: [72],
          night: [450]
        }
      },
      520: {
        dayDose: 490, dayFlowRate: 450, nightDose: 30, nightFlowRate: 80, totalDose: 520,
        intervals: {
          day: [80],
          night: [450]
        }
      },
      470: {
        dayDose: 440, dayFlowRate: 410, nightDose: 30, nightFlowRate: 80, totalDose: 470,
        intervals: {
          day: [87, 88, 88, 88],
          night: [450]
        }
      },
      420: {
        dayDose: 390, dayFlowRate: 360, nightDose: 30, nightFlowRate: 80, totalDose: 420,
        intervals: {
          day: [100],
          night: [450]
        }
      },
      370: {
        dayDose: 340, dayFlowRate: 320, nightDose: 30, nightFlowRate: 80, totalDose: 370,
        intervals: {
          day: [112, 113],
          night: [450]
        }
      },
    },
    lowBattery92For5Percent: 92,
    lowBattery100For20Percent: 100,
    lowBattery120For80Percent: 120,
    lowBattery124For100Percent: 124
  },

  testParams: {
    medicationEmpty: {
      // pumpName: "N12345678",
      // pumpName: "NDM125463", // other gen 2...
      commandParams: "5 0"
    },
    prepareTreatment: {
    }
  }
};

export default config;
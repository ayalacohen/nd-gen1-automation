import { verifyRegimenPassed, verifyRegimenFailed, verifyStartFilling, verifyStartFillingAfterNoResetOfLastFillingPercentage, verifyDbEntry } from "../helpers/dbHelpers.js";
import { parseHour, convertHoursToMs } from "../helpers/generalHelpers.js";
import { logStepMessage } from "../helpers/logger.js";



    export const dbFile = "db/301_1_control_station_logs.db";

    // const expectedValues = {
    //     type_id: 502,
    //     field_a: "Pump Notifies",
    //     field_b: "Pump Alarm Code",
    //     field_c: {
    //         like: [
    //             "Alarm Code: 6",
    //             "Is Alarm ACK: false",
    //             "Is Sound Enabled: true"
    //         ]
    //     }
    // }
    // const expectedValues = {
    //     type_id: 308,
    //     field_a: "6",
    //     field_b: "true",
    //     field_c: {
    //         like: [
    //             "alertCode: 6",
    //             "isActive: true",
    //             "isSoundEnabled: true"
    //         ]
    //     }
    // }
    // const ok = verifyDbEntry(dbFile,  expectedValues);
    // if (ok) {
    //     logStepMessage("✅ CS Logs verification Passed");
    // } else {
    //     throw new Error("CS Logs verification failed");
    // }

        const expectedEntries = [
            {
                type_id: 502,
                field_a: "Pump Notifies",
                field_b: "Pump Alarm Code",
                field_c: {
                    like: [
                        "Alarm Code: 6",
                        "Is Alarm ACK: false",
                        "Is Sound Enabled: true"
                    ]
                }
            },
            {
                type_id: 308,
                field_a: "6",
                field_b: "true",
                field_c: {
                    like: [
                        "alertCode: 6",
                        "isActive: true",
                        "isSoundEnabled: true"
                    ]
                }
            }
        ];

    let allOk = true;

    for (const entry of expectedEntries) {
        if (!verifyDbEntry(dbFile, entry)) {
            allOk = false;
        }
    }

    if (!allOk) {
        throw new Error("CS Logs verification failed");
    }

    // export const dbFile = "db/2635_5_control_station_logs.db";
    // verifyStartFillingAfterNoResetOfLastFillingPercentage(dbFile);

    // export const dbFile = "db/194_8_control_station_logs.db";
    // verifyStartFilling(dbFile);
/*
    const expectedValues = {
    day: {
        nbHours: "18 h",
        start: "4:00 AM",
        end: "10:00 PM",
        doseRate: "590",
        dose: "640"
    },
    night: {
        nbHours: "6 h",
        start: "10:00 PM",
        end: "4:00 AM",
        doseRate: "80",
        dose: "30"
    },
    totalDose: "670"
    };

    export const dbFile = "db/2625_5_control_station_logs.db";

    const startDayInMilliSeconds = convertHoursToMs(parseHour(expectedValues.day.start));
    const startNightInMilliSeconds = convertHoursToMs(parseHour(expectedValues.night.start));

    const expectedJsonFor300 = [
        {
            "": [
            { startTime: 100000, value: 5 },
            { startTime: startNightInMilliSeconds, value: Number(expectedValues.night.doseRate)}
            ]
        }
    ];

    const expectedJsonFor301 = [
        {
            "": [
            { startTime: startDayInMilliSeconds, value: Number(expectedValues.day.doseRate) },
            { startTime: startNightInMilliSeconds, value: Number(expectedValues.night.doseRate)}
            ]
        }
    ];
    const expectedTextFor206 = "Dialog shown: 1036";

    verifyRegimenFailed(dbFile, expectedJsonFor300, expectedJsonFor301, expectedTextFor206);
*/
/*
    const expectedValues = {
    day: {
        nbHours: "18 h",
        start: "4:00 AM",
        end: "10:00 PM",
        doseRate: "500",
        dose: "540"
    },
    night: {
        nbHours: "6 h",
        start: "10:00 PM",
        end: "4:00 AM",
        doseRate: "80",
        dose: "30"
    },
    totalDose: "570"
    };

    export const dbFile = "db/ay26_test_control_station_logs.db";

    // const expectedValues = {
    // day: {
    //     nbHours: "18 h",
    //     start: "05:00 AM",
    //     end: "11:00 PM",
    //     doseRate: "360",
    //     dose: "90"
    // },
    // night: {
    //     nbHours: "6 h",
    //     start: "11:00 PM",
    //     end: "5:00 AM",
    //     doseRate: "80",//80
    //     dose: "30"
    // },
    // totalDose: "420"
    // };

    // export const dbFile = "db/ay9_test_control_station_logs.db";

    const startDayInMilliSeconds = convertHoursToMs(parseHour(expectedValues.day.start));
    const startNightInMilliSeconds = convertHoursToMs(parseHour(expectedValues.night.start));

    export const expectedRegimen = [
        {
            "": [
            { startTime: startDayInMilliSeconds, value: Number(expectedValues.day.doseRate) },
            { startTime: startNightInMilliSeconds, value: Number(expectedValues.night.doseRate)}
            ]
        }
    ];
    /*
    //field c in db: [{"":[{"startTime":18000000,"value":360},{"startTime":82800000,"value":80}]}]

    PS C:\Automation\Gen1> node .\scripts\readCsLogs.js
    [{"":[{"startTime":18000000,"value":360},{"startTime":82800000,"value":80}]}]
    [16:59:50.298] ✅ Found at least one type 300 entry with expected regimen
    [16:59:50.314] ✅ Found at least one type 301 entry with expected regimen
    [16:59:50.315] ✅ Found type 500 'Regimen Verification Passed'
    [16:59:50.315] ✅ CS Logs regimen verification Passed'
    */


    // verifyRegimen(dbFile, expectedRegimen);

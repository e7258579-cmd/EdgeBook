# EdgeBook — Firebase Functions (skeleton)

מה יש כאן, איך מפעילים, ומה עדיין לא מאומת. חוזה ההודעות: `docs/WEBHOOK_CONTRACT_V01.md`.

## מבנה

```
skeleton/
  firebase.json
  functions/
    index.js            מקלט (tzWebhook), מעבד (tzProcessSignal), בדיקה ישנה (tzWebhookTest)
    legacyTest.js       בדיקת החיבור המקורית, נשמרה כדי שהתראת הבדיקה הישנה תמשיך לעבוד
    tradezero.js        לקוח TradeZero (getAccount, placeOrder, getOrder, awaitTerminal)
    lib/                לוגיקה טהורה: validate, sizing, limits, config, process, brokers, firestoreStore
    test/               בדיקות יחידה (node:test)
```

## בדיקות (לא דורשות Firebase או TradeZero)

```
cd skeleton/functions
npm test
```

## הגדרה ב-Firestore: `control/config`

כל השדות אופציונליים. ברירות המחדל בקוד (`lib/config.js`). שינוי כאן נכנס לתוקף באות הבא, בלי פריסה מחדש.

| שדה | ברירת מחדל | משמעות |
|---|---|---|
| `dryRun` | `true` | `true` = רק רושם מה היה נשלח, לא קורא ל-TradeZero. **להעביר ל-`false` רק אחרי שהלוגים נראים תקינים** |
| `killSwitch` | `false` | `true` = אין כניסות חדשות (יציאות תמיד מותרות) |
| `accountEquityUsd` | `500` | גודל החשבון שעליו מחושב הסיכון |
| `riskPct` | `1` | % מההון בסיכון בכל עסקה |
| `maxShares` | `25` | תקרת מניות |
| `maxPositionUsd` | `500` | תקרת שווי פוזיציה |
| `maxDailyLossUsd` | `20` | אחרי הפסד נטו של 20$ היום (שעון ניו יורק) אין כניסות חדשות |
| `maxTradesPerDay` | `10` | כניסות ליום |
| `maxOrdersPerMinute` | `6` | הזמנות ב-60 השניות האחרונות |
| `limitOffsetUsd` | `0.10` | קנייה: מחיר + offset. מכירה: מחיר - offset |
| `maxSignalAgeSec` | `180` | אות ישן יותר נזרק |
| `timeInForce` | `"Day"` | ⚠️ לא אומת לשעות מורחבות |

## אוספים שנכתבים

`signals` (כל אות וסטטוס שלו), `positions` (פוזיציות פתוחות), `orders` (כל הזמנה שנשלחה), `trades` (עסקאות סגורות), `stats/{תאריך}` (מונים יומיים).

## פריסה

מתוך `skeleton/`: `firebase deploy --only functions`. הסיסמאות (`WEBHOOK_SECRET`, `TZ_API_KEY_ID`, `TZ_API_SECRET_KEY`, `TZ_ACCOUNT_ID`) נשמרות ב-Firebase Secrets כמו עד עכשיו. כתובת ה-Webhook החדשה היא של `tzWebhook`.

## מה עדיין לא מאומת או לא ממומש (חשוב לפני `dryRun: false`)

1. ⚠️ **`cancelOrder` לא ממומש.** נקודת הקצה לא אומתה מול התיעוד של TradeZero (הגישה לאתר חסומה מהסביבה שבה נכתב הקוד). יציאה שמצריכה ביטול כניסה שעדיין לא התמלאה נגמרת בשגיאה מפורשת (`entry_not_filled_cancel_failed`), לא בניחוש.
2. ✅ **אומת מדף ה-MCP של TradeZero** (לא מדף ה-REST עצמו): `side` הוא `Buy`/`Sell`, `openClose` הוא `Open`/`Close`, סוגי פקודה `Market`/`Limit`/`Stop`/`StopLimit`, והסטטוסים הסופיים הם `Filled`, `Canceled`, `Rejected` (כתיב עם L אחת). הזהרה מהדף: אין לבטל פקודה שנדחתה (`Rejected`), והקוד כבר מטפל בזה לפני ניסיון ביטול. ⚠️ עדיין לא ידוע: שם הסטטוס של מילוי חלקי (כרגע כל סטטוס שאינו `Filled` נחשב "לא מלא" וינסה לבטל, מה שעלול להשאיר מניות שהתמלאו חלקית), הערכים התקפים של `route` ו-`timeInForce` (הדף אומר שחייבים להתאים ל-`get_routes`), ונקודות ה-REST לביטול, פוזיציות והזמנות פתוחות.
3. ⚠️ **אין מעקב אחרי מילויים.** הרווח בעסקה מחושב ממחירי האותות, לא ממילוי בפועל, והפוזיציה נמחקת מהרישום ברגע ששולחים פקודת מכירה.
4. ⚠️ **אין סטופ אמיתי אצל הברוקר** ואין עדיין "Dead-man's switch" לפרה-מרקט.
5. ⚠️ **אזור Firestore:** ה-Trigger של המעבד דורש התאמה בין אזור הפונקציה (ברירת מחדל `us-central1`) לאזור מסד הנתונים. אם הפריסה מתלוננת, צריך להגדיר `region` ב-`onDocumentCreated`.
6. ⚠️ **גודל החשבון קבוע** בהגדרות (`accountEquityUsd`), לא נקרא מ-TradeZero (שם השדה ב-`getAccount` לא אומת).

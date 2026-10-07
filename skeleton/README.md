# EdgeBook — Firebase Functions (skeleton)

מה יש כאן, איך מפעילים, ומה עדיין לא מאומת. חוזה ההודעות: `docs/WEBHOOK_CONTRACT_V02.md`.

## מבנה

```
skeleton/
  firebase.json
  functions/
    index.js            מקלט עם מסלול מהיר לכניסה (tzWebhook), המשך כניסה (tzFollowUp), מעבד/מנהל פוזיציות (tzProcessSignal), בדיקת התאמה כל דקה (tzReconcile), בדיקה ישנה (tzWebhookTest)
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
| `maxSignalAgeSec` | `180` | כניסה או `stop_update` ישנים יותר נזרקים (יציאה תמיד מבוצעת) |
| `stopOffsetUsd` | `0.10` | StopLimit מגן: ליימיט = מחיר הסטופ - offset |
| `stopTimeInForce` | `""` | ריק = אוטומטי: `Day_Plus` ב-Live (תקף 04:00–20:00), `Day` ב-Paper |
| `entryWaitMs` | `4000` | כמה ממתינים למילוי כניסה לפני שמשאירים אותה ממתינה |
| `entryTimeoutSec` | `30` | כניסה שלא התמלאה אחרי זמן זה מבוטלת |
| `sellWaitMs` | `3000` | כמה ממתינים למילוי מכירה לפני ביטול ושליחה מחדש |
| `maxReprices` | `3` | כמה פעמים שולחים מכירה מחדש נמוך יותר |
| `repriceStepUsd` | `0.10` | בכמה יורדים בכל שליחה מחדש |
| `heartbeatMaxAgeSec` | `900` | התראה אם לסמל עם פוזיציה אין heartbeat כל כך הרבה זמן |
| `timeInForce` | `"Day"` | ⚠️ לא אומת לשעות מורחבות |
| `route` | `""` | ריק = TradeZero בוחר (ב-Paper זה אוטומטי: PAPER/PAPERM). **ב-Live חובה route מפורש מ-`GET /routes`** |
| `environment` | `"paper"` | `"paper"` או `"live"`. הכתיבה נחסמת אם סוג החשבון (`accountType`) לא תואם |

## אוספים שנכתבים

`signals` (כל אות, סטטוס ו-`latencyMs`), `heartbeats` (אחד לסמל), `positions` (פתוחות או ממתינות), `locks` (נעילת סמל), `orders` (כל הזמנה שנשלחה, עם `purpose`), `trades` (עסקאות סגורות), `stats/{תאריך}` (מונים יומיים), `alerts` (דברים שדורשים התערבות).

## פריסה

מתוך `skeleton/`: `firebase deploy --only functions`. `tzReconcile` דורשת Cloud Scheduler (חיוב מופעל).

## כללי TradeZero שהקוד מיישם (דף "API Conventions")

- HTTP 200 לא אומר הצלחה: דחיית פקודה חוזרת כ-200 עם `orderStatus: "Rejected"`. הקוד קורא את הסטטוס ולא מסתפק ב-200.
- `clientOrderId` הוא מפתח למניעת כפילויות, לא Idempotency: שליחה שנייה עם אותו מזהה נדחית (R114). אחרי כשל עמום (5xx/רשת) הקוד **לא שולח שוב**, אלא בודק אם ההזמנה קיימת (`GET /order/{id}`, עם ניסיונות חוזרים על 404 כ-2 שניות). אם היא קיימת, ממשיכים; אם נעדרת, משחררים; אם אי אפשר לדעת, הסמל נשאר חסום וצריך בדיקה ידנית.
- שגיאת 4xx על POST פירושה שההזמנה לא נוצרה.
- אין לבטל פקודה ב-`Rejected`/`Canceled`.
- מילוי חלקי: הקוד מבטל את שארית הכניסה ומוכר רק את `executed` (כמות שמולאה). ⚠️ שם השדה `executed` נלקח מהמלצת הדף ("reconcile against orderStatus, executed, leavesQuantity"), ולא נבדק על תשובה אמיתית.
- מחירים: עד 4 ספרות אחרי הנקודה. מחיר שווה או מעל 1$ מעוגל לסנט, מתחת ל-1$ ל-0.0001 (ה-offset של 0.10$ ענק לשוק של מניה זולה, אבל זה מה שנקבע).
- **סטופ אצל הברוקר:** אחרי שכניסה התמלאה (`Filled`, כפי שהתיעוד מורה) מוצב StopLimit למכירה (Close) ברמת `stop` עם ליימיט `stop - 0.10$`. הסטופ מוזז לפי הודעות `stop_update` בביטול והצבה מחדש עם מזהה חדש, ובכל מקרה ממתינים לסטטוס סופי לפני הצבה. ביציאה: ביטול הסטופ, מכירה ב-Limit לפי `last - 0.10$`, וניסיונות חוזרים נמוכים יותר.
- ביטול כניסה שעדיין לא התמלאה: אחרי שליחת ה-DELETE הקוד **ממתין לסטטוס סופי** (`Filled`/`Canceled`/`Rejected`/`Expired`/`DoneForDay`) ולא מסתמך על תשובת הביטול (404 יכול לאמר "כבר התמלאה", ו-`PendingCancel` עדיין יכולה להתמלא). אם הסטטוס לא הסתיים, הפוזיציה נשארת חסומה עם שגיאה מפורשת.
- אורך `clientOrderId`: עד 36 תווים ב-Live. המזהים שלנו (`eb-<סמל>-<זמן נר>-B/S`) עד 29 תווים.
- אין Modify: שינוי הזמנה = ביטול ושליחה מחדש עם מזהה חדש.
- סביבה: Paper ו-Live על אותו host, והמפתחות קובעים. לכן הקוד קורא את `accountType` לפני כל כתיבה וחוסם אם לא תואם ל-`environment`.
- Rate limit: 429 ללא `Retry-After`. 429 על POST נחשב "ההזמנה לא נוצרה". אין עדיין ניסיון חוזר אוטומטי.

## מה עדיין לא מאומת או לא ממומש (חשוב לפני `dryRun: false`)

1. ✅ `cancelOrder` (`DELETE /accounts/:accountId/orders/:clientOrderId`, "orders" ברבים), `getTodaysOrders` ו-`getRoutes` ממומשים לפי טבלת הנתיבים. ⚠️ צורת תשובת הביטול לא ידועה (הקוד סובל כל תשובה).
2. ✅ **`timeInForce: "Day"` עם Limit תקף מ-04:00 בבוקר** ב-SMART (גם ב-Live), ונשאר תקף אחרי 16:00. פקודות Market ו-Stop עם Day דחויות מחוץ ל-09:30–16:00 (R100 ב-Live), בהתאם להחלטה שלא להשתמש ב-Market. ב-Live חובה `route` מפורש מ-`GET /routes` (בלעדיו, R54).
3. ⚠️ **נתיב ה-REST לקריאת פוזיציות** חסר, ולכן אין בדיקת פוזיציה מול TradeZero (רק מול ה-Firestore שלנו).
4. ✅ מילוי מכירה ומילוי סטופ נבדקים (המכירה ממתינה לסטטוס סופי, הסטופ נבדק כל דקה ב-`tzReconcile`). ⚠️ אבל זה בדיקה תכופה ולא Portfolio WebSocket, כלומר סטופ שהתמלא יירשם עד דקה אחריו. ההגנה עצמה (הסטופ אצל הברוקר) לא מושפעת.
5. ⚠️ **סטופ בפרה-מרקט:** ב-Live, StopLimit עם `Day_Plus` תקף מ-04:00 (לפי התיעוד). ב-Paper לא ניתן לבדוק (שם StopLimit עם Day תקף רק 09:30–16:00). StopLimit עלול לא להתמלא אם המחיר קופץ מתחת לליימיט.
6. ✅ **אזור:** מסד ה-Firestore של הפרויקט נמצא ב-`europe-west1` (כך הפריסה זיהתה). כל הפונקציות החדשות מוגדרות לאותו אזור (`setGlobalOptions` ב-`index.js`), כי המקלט עושה כמה קריאות ל-Firestore לכל אות והן איטיות מעבר לאוקיינוס. `tzWebhookTest` הישנה נשארה ב-`us-central1`. כתובת ה-Webhook: `https://europe-west1-edgebook-55d06.cloudfunctions.net/tzWebhook`.
7. ⚠️ **גודל החשבון קבוע** בהגדרות (`accountEquityUsd`). שם השדה של ההון ב-`GET /account/{id}` (לפי הדף: `bp` לכוח קנייה בתשובת הפירוט) לא נבדק על תשובה אמיתית.

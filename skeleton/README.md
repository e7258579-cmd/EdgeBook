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
| `route` | `""` | ריק = TradeZero בוחר (ב-Paper זה אוטומטי: PAPER/PAPERM). **ב-Live חובה route מפורש מ-`GET /routes`** |
| `environment` | `"paper"` | `"paper"` או `"live"`. הכתיבה נחסמת אם סוג החשבון (`accountType`) לא תואם |

## אוספים שנכתבים

`signals` (כל אות וסטטוס שלו), `positions` (פוזיציות פתוחות), `orders` (כל הזמנה שנשלחה), `trades` (עסקאות סגורות), `stats/{תאריך}` (מונים יומיים).

## פריסה

מתוך `skeleton/`: `firebase deploy --only functions`. הסיסמאות (`WEBHOOK_SECRET`, `TZ_API_KEY_ID`, `TZ_API_SECRET_KEY`, `TZ_ACCOUNT_ID`) נשמרות ב-Firebase Secrets כמו עד עכשיו. כתובת ה-Webhook החדשה היא של `tzWebhook`.

## כללי TradeZero שהקוד מיישם (דף "API Conventions")

- HTTP 200 לא אומר הצלחה: דחיית פקודה חוזרת כ-200 עם `orderStatus: "Rejected"`. הקוד קורא את הסטטוס ולא מסתפק ב-200.
- `clientOrderId` הוא מפתח למניעת כפילויות, לא Idempotency: שליחה שנייה עם אותו מזהה נדחית (R114). אחרי כשל עמום (5xx/רשת) הקוד **לא שולח שוב**, אלא בודק אם ההזמנה קיימת (`GET /order/{id}`, עם ניסיונות חוזרים על 404 כ-2 שניות). אם היא קיימת, ממשיכים; אם נעדרת, משחררים; אם אי אפשר לדעת, הסמל נשאר חסום וצריך בדיקה ידנית.
- שגיאת 4xx על POST פירושה שההזמנה לא נוצרה.
- אין לבטל פקודה ב-`Rejected`/`Canceled`.
- מילוי חלקי: הקוד מבטל את שארית הכניסה ומוכר רק את `executed` (כמות שמולאה). ⚠️ שם השדה `executed` נלקח מהמלצת הדף ("reconcile against orderStatus, executed, leavesQuantity"), ולא נבדק על תשובה אמיתית.
- מחירים: עד 4 ספרות אחרי הנקודה. מחיר שווה או מעל 1$ מעוגל לסנט, מתחת ל-1$ ל-0.0001 (ה-offset של 0.10$ ענק לשוק של מניה זולה, אבל זה מה שנקבע).
- ביטול כניסה שעדיין לא התמלאה: אחרי שליחת ה-DELETE הקוד **ממתין לסטטוס סופי** (`Filled`/`Canceled`/`Rejected`/`Expired`/`DoneForDay`) ולא מסתמך על תשובת הביטול (404 יכול לאמר "כבר התמלאה", ו-`PendingCancel` עדיין יכולה להתמלא). אם הסטטוס לא הסתיים, הפוזיציה נשארת חסומה עם שגיאה מפורשת.
- אורך `clientOrderId`: עד 36 תווים ב-Live. המזהים שלנו (`eb-<סמל>-<זמן נר>-B/S`) עד 29 תווים.
- אין Modify: שינוי הזמנה = ביטול ושליחה מחדש עם מזהה חדש.
- סביבה: Paper ו-Live על אותו host, והמפתחות קובעים. לכן הקוד קורא את `accountType` לפני כל כתיבה וחוסם אם לא תואם ל-`environment`.
- Rate limit: 429 ללא `Retry-After`. 429 על POST נחשב "ההזמנה לא נוצרה". אין עדיין ניסיון חוזר אוטומטי.

## מה עדיין לא מאומת או לא ממומש (חשוב לפני `dryRun: false`)

1. ✅ `cancelOrder` (`DELETE /accounts/:accountId/orders/:clientOrderId`, "orders" ברבים), `getTodaysOrders` ו-`getRoutes` ממומשים לפי טבלת הנתיבים. ⚠️ צורת תשובת הביטול לא ידועה (הקוד סובל כל תשובה).
2. ✅ **`timeInForce: "Day"` עם Limit תקף מ-04:00 בבוקר** ב-SMART (גם ב-Live), ונשאר תקף אחרי 16:00. פקודות Market ו-Stop עם Day דחויות מחוץ ל-09:30–16:00 (R100 ב-Live), בהתאם להחלטה שלא להשתמש ב-Market. ב-Live חובה `route` מפורש מ-`GET /routes` (בלעדיו, R54).
3. ⚠️ **נתיב ה-REST לקריאת פוזיציות** חסר, ולכן אין בדיקת פוזיציה מול TradeZero (רק מול ה-Firestore שלנו).
4. ⚠️ **אין מעקב אחרי מילויי מכירה.** הרווח בעסקה מחושב ממחירי האותות, והפוזיציה נמחקת מהרישום ברגע שפקודת המכירה התקבלה. כדי לדעת מילוי בפועל צריך לבדוק את הפקודה או להאזין ל-Portfolio Stream (WebSocket, בטא).
5. ⚠️ **אין סטופ אמיתי אצל הברוקר** ואין עדיין "Dead-man's switch" לפרה-מרקט. **ממצא חדש מהתיעוד:** ב-Live ב-SMART אפשר לשים פקודת **StopLimit עם `Day_Plus`** כבר מ-04:00 עד 20:00 (Stop רגיל רק 09:30–16:00). ב-Paper לא (המסלול PAPER לא מציע `Day_Plus`, ו-StopLimit עם Day רק 09:30–16:00). סיכון: StopLimit עלול לא להתמלא אם המחיר קופץ מעבר לליימיט. ההנחיה של TradeZero: להציב סטופ רק אחרי שהכניסה במצב `Filled`.
6. ⚠️ **אזור Firestore:** ה-Trigger של המעבד דורש התאמה בין אזור הפונקציה (ברירת מחדל `us-central1`) לאזור מסד הנתונים. אם הפריסה מתלוננת, צריך להגדיר `region` ב-`onDocumentCreated`.
7. ⚠️ **גודל החשבון קבוע** בהגדרות (`accountEquityUsd`). שם השדה של ההון ב-`GET /account/{id}` (לפי הדף: `bp` לכוח קנייה בתשובת הפירוט) לא נבדק על תשובה אמיתית.

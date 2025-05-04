# Firebase Cloud Functions for Order Notifications

This directory contains Firebase Cloud Functions that send notifications when new orders are added to the Firestore database.

## Functions

### `sendNewOrderNotification`

This function triggers when a new document is created in the `orders` collection. If the order status is "new", it sends a notification to all devices subscribed to the "new_orders" topic.

### `subscribeToTopic`

An HTTP callable function that allows devices to subscribe to the "new_orders" topic.

## Deployment

To deploy these functions to Firebase:

1. Make sure you have the Firebase CLI installed:

```
npm install -g firebase-tools
```

2. Login to Firebase:

```
firebase login
```

3. Initialize Firebase in your project (if not already done):

```
firebase init
```

4. Deploy the functions:

```
firebase deploy --only functions
```

## Testing

You can test the functions by adding a new document to the `orders` collection with `status: "new"`:

```javascript
// Example using Firebase Admin SDK or client library
db.collection("orders").add({
  status: "new",
  // other order data
});
```

## Client Integration

In your mobile app, make sure to:

1. Request notification permissions
2. Get the FCM token
3. Subscribe to the "new_orders" topic:

```javascript
// React Native example
import messaging from "@react-native-firebase/messaging";

// Subscribe to the topic
await messaging().subscribeToTopic("new_orders");
```

## Cloud Function Logs

To view logs from your deployed functions:

```
firebase functions:log
```

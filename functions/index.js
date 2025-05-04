const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onCall } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();

// Function that triggers when a new document is created or updated in the 'orders' collection
exports.sendNewOrderNotification = onDocumentWritten(
  "orders/{orderId}",
  async (event) => {
    try {
      console.log("Function triggered for order:", event.params.orderId);

      // Null check and logging for event data
      if (!event.data) {
        console.error("Event data is null or undefined");
        return { success: false, error: "No event data" };
      }

      const snapshot = event.data.after;
      if (!snapshot) {
        console.log("Document was deleted, no notification needed");
        return { success: false, message: "Document was deleted" };
      }

      const orderData = snapshot.data();

      // More detailed logging
      console.log("Order data:", JSON.stringify(orderData));

      const orderId = event.params.orderId;

      // Only send notification if order status is 'search_courier'
      if (orderData && orderData.status === "search_courier") {
        console.log('Order with status "search_courier" detected:', orderId);

        // You can customize these values based on your order data
        const notificationTitle = "Yangi buyurtma mavjud";
        const notificationBody = `Buyurtma uchun kuryer kerak: ${
          (orderData.deliveryPrice >= 4000 ? orderData.deliveryPrice : 4000) ||
          ""
        }`;

        // Use send() method directly with a proper message object
        const message = {
          notification: {
            title: notificationTitle,
            body: notificationBody,
          },
          data: {
            orderId: orderId,
            click_action: "FLUTTER_NOTIFICATION_CLICK",
            timestamp: Date.now().toString(),
            type: "search_courier",
          },
          topic: "new_orders",
          android: {
            priority: "high",
            ttl: 60 * 1000, // 60 sekund
            notification: {
              sound: "default",
            },
          },
        };

        console.log("Sending notification message:", JSON.stringify(message));

        try {
          // Send message using the proper API
          const response = await admin.messaging().send(message);
          console.log("FCM response:", response);
          return {
            success: true,
            message: "Notification sent successfully",
            response,
          };
        } catch (sendError) {
          console.error("Error sending FCM message:", sendError);
          return { success: false, error: sendError.message };
        }
      }

      console.log(
        `Order status is not "search_courier" or missing. Status: ${
          orderData ? orderData.status : "unknown"
        }`
      );
      return {
        success: false,
        message: `Order status is not "search_courier" or missing. Status: ${
          orderData ? orderData.status : "unknown"
        }`,
      };
    } catch (error) {
      console.error("Error in notification function:", error);
      return { success: false, error: error.message };
    }
  }
);

// Optional: A function to subscribe devices to the 'new_orders' topic
exports.subscribeToTopic = onCall(async (request) => {
  const { token } = request.data;

  if (!token) {
    throw new Error("The function must be called with a valid FCM token.");
  }

  try {
    await admin.messaging().subscribeToTopic([token], "new_orders");
    console.log(
      `Device with token subscribed to 'new_orders' topic: ${token.substring(
        0,
        20
      )}...`
    );
    return {
      success: true,
      message: "Successfully subscribed to new_orders topic",
    };
  } catch (error) {
    console.error("Error subscribing to topic:", error);
    throw new Error(error.message);
  }
});

class AppConstants {
  AppConstants._();

  static const String appName = 'Shoot The Ball';
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:4000/v1',
  );
  static const int connectTimeoutMs = 30000;
  static const int receiveTimeoutMs = 30000;
  static const int maxRetries = 3;

  static const String storageKeyToken = 'auth_token';
  static const String storageKeyUserId = 'user_id';
}

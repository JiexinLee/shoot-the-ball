import 'package:flutter_riverpod/flutter_riverpod.dart';

enum HighlightType { madeBasket, threePointer, assist, steal, block }

class Highlight {
  final String id;
  final String videoId;
  final double startTime;
  final double endTime;
  final double eventTime;
  final double confidence;
  final HighlightType type;
  final String? clipUrl;
  final String? thumbnailUrl;
  final bool selected;
  final bool deleted;

  Highlight({
    required this.id,
    required this.videoId,
    required this.startTime,
    required this.endTime,
    required this.eventTime,
    required this.confidence,
    required this.type,
    this.clipUrl,
    this.thumbnailUrl,
    this.selected = true,
    this.deleted = false,
  });

  Highlight copyWith({
    String? id,
    String? videoId,
    double? startTime,
    double? endTime,
    double? eventTime,
    double? confidence,
    HighlightType? type,
    String? clipUrl,
    String? thumbnailUrl,
    bool? selected,
    bool? deleted,
  }) {
    return Highlight(
      id: id ?? this.id,
      videoId: videoId ?? this.videoId,
      startTime: startTime ?? this.startTime,
      endTime: endTime ?? this.endTime,
      eventTime: eventTime ?? this.eventTime,
      confidence: confidence ?? this.confidence,
      type: type ?? this.type,
      clipUrl: clipUrl ?? this.clipUrl,
      thumbnailUrl: thumbnailUrl ?? this.thumbnailUrl,
      selected: selected ?? this.selected,
      deleted: deleted ?? this.deleted,
    );
  }
}

class HighlightsNotifier extends StateNotifier<List<Highlight>> {
  HighlightsNotifier() : super([]);

  Future<void> fetchHighlights(String videoId) async {
    state = [];
  }

  void toggleSelection(String highlightId) {
    state = state
        .map((h) => h.id == highlightId ? h.copyWith(selected: !h.selected) : h)
        .toList();
  }

  void updateRange(String highlightId, double start, double end) {
    state = state
        .map((h) =>
            h.id == highlightId ? h.copyWith(startTime: start, endTime: end) : h)
        .toList();
  }

  void deleteHighlight(String highlightId) {
    state = state
        .map((h) => h.id == highlightId ? h.copyWith(deleted: true) : h)
        .toList();
  }

  List<Highlight> get selectedHighlights =>
      state.where((h) => h.selected && !h.deleted).toList();
}

final highlightsProvider =
    StateNotifierProvider<HighlightsNotifier, List<Highlight>>(
  (ref) => HighlightsNotifier(),
);

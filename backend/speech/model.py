import torch
from torch import nn
from torch.nn.utils.rnn import pack_padded_sequence, pad_packed_sequence

from backend.speech.text import VOCABULARY


def features(waveform):
    waveform = torch.as_tensor(waveform, dtype=torch.float32)
    if waveform.ndim != 1 or waveform.numel() < 400:
        raise ValueError("Expected at least 25 ms of mono audio.")
    spectrum = torch.stft(
        waveform, n_fft=400, hop_length=160, win_length=400,
        window=torch.hann_window(400), return_complex=True,
    ).abs().square().clamp_min(1e-8).log()
    spectrum = (spectrum - spectrum.mean(dim=1, keepdim=True)) / spectrum.std(dim=1, keepdim=True).clamp_min(1e-5)
    return spectrum.transpose(0, 1)


class SpeechModel(nn.Module):
    def __init__(self, hidden_size=96):
        super().__init__()
        self.hidden_size = hidden_size
        self.encoder = nn.Sequential(nn.Conv1d(201, hidden_size, 5, stride=2, padding=2), nn.GELU())
        self.recurrent = nn.GRU(hidden_size, hidden_size, num_layers=2, batch_first=True, bidirectional=True)
        self.classifier = nn.Linear(hidden_size * 2, len(VOCABULARY))

    def forward(self, inputs, lengths):
        encoded = self.encoder(inputs.transpose(1, 2)).transpose(1, 2)
        output_lengths = (lengths + 1) // 2
        packed = pack_padded_sequence(encoded, output_lengths.cpu(), batch_first=True, enforce_sorted=False)
        recurrent, _ = self.recurrent(packed)
        padded, _ = pad_packed_sequence(recurrent, batch_first=True)
        return self.classifier(padded).log_softmax(dim=-1), output_lengths
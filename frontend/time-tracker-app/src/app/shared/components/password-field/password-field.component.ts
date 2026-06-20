import { Component, forwardRef, input, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

@Component({
  selector: 'app-password-field',
  templateUrl: './password-field.component.html',
  styleUrl: './password-field.component.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => PasswordFieldComponent),
      multi: true
    }
  ]
})
export class PasswordFieldComponent implements ControlValueAccessor {
  readonly label = input.required<string>();
  readonly id = input.required<string>();
  readonly hint = input<string>();
  readonly placeholder = input('••••••••');
  readonly autocomplete = input('current-password');

  readonly showPassword = signal(false);

  value = '';
  disabled = false;

  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  writeValue(value: string): void {
    this.value = value ?? '';
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  onInput(event: Event): void {
    const inputEl = event.target as HTMLInputElement;
    this.value = inputEl.value;
    this.onChange(this.value);
  }

  onBlur(): void {
    this.onTouched();
  }

  toggleVisibility(): void {
    this.showPassword.update((visible) => !visible);
  }
}

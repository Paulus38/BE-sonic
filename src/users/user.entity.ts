import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { Recording } from '../recordings/recording.entity';
import { DictionaryItem } from '../dictionary/dictionary-item.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ unique: true, type: 'varchar', length: 255 })
  email!: string;

  @Exclude()
  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  avatar!: string | null;

  @Column({ name: 'primary_lang', type: 'varchar', length: 64, default: 'Tiếng Việt' })
  primaryLang!: string;

  @Column({ name: 'secondary_lang', type: 'varchar', length: 64, default: 'Tiếng Anh (US)' })
  secondaryLang!: string;

  @Column({ name: 'sample_rate', type: 'integer', default: 48 })
  sampleRate!: number;

  @Column({ name: 'ai_noise_cancellation', type: 'boolean', default: true })
  aiNoiseCancellation!: boolean;

  @Column({ type: 'varchar', length: 16, default: 'light' })
  theme!: 'light' | 'dark';

  /** Personal context used to personalize AI reply suggestions */
  @Column({ type: 'varchar', length: 500, nullable: true })
  job!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  hobbies!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  habits!: string | null;

  @Column({ name: 'about_me', type: 'varchar', length: 1000, nullable: true })
  aboutMe!: string | null;

  /** RBAC: user | admin */
  @Column({ type: 'varchar', length: 16, default: 'user' })
  role!: 'user' | 'admin';

  /** FCM device token — push notifications (mobile app). */
  @Column({ name: 'fcm_token', type: 'varchar', length: 500, nullable: true })
  fcmToken!: string | null;

  @OneToMany(() => Recording, (recording) => recording.user)
  recordings!: Recording[];

  @OneToMany(() => DictionaryItem, (item) => item.user)
  dictionaryItems!: DictionaryItem[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt!: Date | null;
}
